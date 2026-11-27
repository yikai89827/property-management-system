import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import {
  ErrorCodes,
  FeeParameterCode,
  HouseStatus,
  HouseStatusTransitionMatrix,
  isVacantDiscountEligible,
  LedgerStatus,
  normalizeHouseStatus,
  PropertyType,
  normalizePropertyType,
  ResidentType,
} from '@pms/shared';
import { BusinessException } from '../../common/exceptions/business.exception';
import { CryptoService, isValidIdCard, isValidPhone, isValidPlateNo } from '../../common/crypto/crypto.service';
import { TenantService } from '../../common/tenant/tenant.service';
import {
  CustomerChangeLogEntity,
  CustomerEntity,
  DecorateFilingEntity,
  OwnershipHistoryEntity,
  PersonEntity,
  ProjectEntity,
  VehiclePlateEntity,
} from '../../database/entities/org-entities';
import { ExtKeyRegistryEntity } from '../../database/entities/auth-entities';
import { PropertyFeeLedgerEntity, ReceiptOrderEntity } from '../../database/entities/charging-entities';
import { FeeParameterService } from '../fee-parameter/fee-parameter.service';
import { FeeCalculationService } from '../fee-calculation/fee-calculation.service';

const SENSITIVE_FIELDS = new Set(['phone', 'idCard']);
/** 档案确认后需解锁才能改的核心字段 */
const PROTECTED_PROFILE_FIELDS = new Set([
  'name',
  'phone',
  'idCard',
  'roomNo',
  'houseArea',
  'feeStartDate',
  'contractDate',
  'decorateDate',
  'residentType',
  'propertyType',
  'projectId',
]);
const PROFILE_UNLOCK_TTL_MS = 30 * 60 * 1000;

@Injectable()
export class CustomerService {
  private readonly crypto = new CryptoService();

  constructor(
    @InjectRepository(CustomerEntity) private readonly customerRepo: Repository<CustomerEntity>,
    @InjectRepository(PersonEntity) private readonly personRepo: Repository<PersonEntity>,
    @InjectRepository(ProjectEntity) private readonly projectRepo: Repository<ProjectEntity>,
    @InjectRepository(VehiclePlateEntity) private readonly plateRepo: Repository<VehiclePlateEntity>,
    @InjectRepository(CustomerChangeLogEntity) private readonly changeLogRepo: Repository<CustomerChangeLogEntity>,
    @InjectRepository(OwnershipHistoryEntity) private readonly ownershipRepo: Repository<OwnershipHistoryEntity>,
    @InjectRepository(DecorateFilingEntity) private readonly decorateRepo: Repository<DecorateFilingEntity>,
    @InjectRepository(ReceiptOrderEntity) private readonly receiptRepo: Repository<ReceiptOrderEntity>,
    @InjectRepository(PropertyFeeLedgerEntity) private readonly ledgerRepo: Repository<PropertyFeeLedgerEntity>,
    @InjectRepository(ExtKeyRegistryEntity) private readonly extKeyRepo: Repository<ExtKeyRegistryEntity>,
    private readonly tenantService: TenantService,
    private readonly feeParameterService: FeeParameterService,
  ) {}

  isProfileLocked(customer: CustomerEntity): boolean {
    if (!customer.profileConfirmedAt) return false;
    if (customer.profileUnlockUntil && new Date(customer.profileUnlockUntil).getTime() > Date.now()) {
      return false;
    }
    return true;
  }

  /**
   * 自然人 upsert：
   * - 有身份证：仍按身份证唯一；
   * - 无身份证（历史台账常见）：按手机号唯一，姓名须一致。
   * 同一人可绑定多个项目/房号。
   */
  async ensurePerson(
    companyId: number,
    input: { name: string; phone: string; idCard?: string },
  ): Promise<PersonEntity> {
    if (!isValidPhone(input.phone)) {
      throw new BusinessException(ErrorCodes.VALIDATION_FAILED, '电话须为国内手机号格式');
    }
    const phoneBlind = this.crypto.blindIndex(input.phone);
    const idCard = input.idCard?.trim().toUpperCase() || '';

    if (idCard) {
      if (!isValidIdCard(idCard)) throw new BusinessException(ErrorCodes.ID_CARD_INVALID);
      const blind = this.crypto.blindIndex(idCard);
      let person = await this.personRepo.findOne({ where: { companyId, idCardBlindIndex: blind } });
      if (!person) {
        // 同手机号已存在无证档案时，补录身份证
        person = await this.personRepo.findOne({ where: { companyId, phoneBlindIndex: phoneBlind } });
        if (person) {
          if (person.name !== input.name) {
            throw new BusinessException(ErrorCodes.ID_CARD_PERSON_MISMATCH, '该手机号已绑定其他姓名');
          }
          person.idCardEncrypted = this.crypto.encrypt(idCard);
          person.idCardBlindIndex = blind;
          return this.personRepo.save(person);
        }
        return this.personRepo.save(
          this.personRepo.create({
            companyId,
            name: input.name,
            phoneEncrypted: this.crypto.encrypt(input.phone),
            phoneBlindIndex: phoneBlind,
            idCardEncrypted: this.crypto.encrypt(idCard),
            idCardBlindIndex: blind,
          }),
        );
      }
      if (person.name !== input.name) {
        throw new BusinessException(ErrorCodes.ID_CARD_PERSON_MISMATCH);
      }
      if (person.phoneBlindIndex !== phoneBlind) {
        person.phoneEncrypted = this.crypto.encrypt(input.phone);
        person.phoneBlindIndex = phoneBlind;
        person = await this.personRepo.save(person);
      }
      return person;
    }

    // 无身份证：手机号为主键
    let person = await this.personRepo.findOne({ where: { companyId, phoneBlindIndex: phoneBlind } });
    if (!person) {
      return this.personRepo.save(
        this.personRepo.create({
          companyId,
          name: input.name,
          phoneEncrypted: this.crypto.encrypt(input.phone),
          phoneBlindIndex: phoneBlind,
          idCardEncrypted: undefined,
          idCardBlindIndex: undefined,
        }),
      );
    }
    if (person.name !== input.name) {
      throw new BusinessException(
        ErrorCodes.VALIDATION_FAILED,
        '该手机号已登记为其他姓名，请核对（手机号+姓名需一致）',
      );
    }
    return person;
  }

  /** 客户档案创建（手机号 → 自然人主识别；身份证可选；同项目房号唯一；跨项目可同人多房） */
  async create(input: {
    projectId: number;
    name: string;
    phone: string;
    roomNo: string;
    idCard?: string;
    houseArea: number;
    contractDate?: string;
    feeStartDate: string;
    decorateDate?: string;
    houseStatus: HouseStatus;
    residentType?: ResidentType;
    propertyType?: PropertyType;
    /** 期初已缴月数（导入用，写入台账） */
    paidMonths?: number;
    ext?: Record<string, unknown>;
  }) {
    const companyId = this.tenantService.requireCompanyId();
    if (!input.name || !input.phone || !input.roomNo || !input.houseArea || !input.feeStartDate) {
      throw new BusinessException(ErrorCodes.VALIDATION_FAILED, '姓名/手机号/房号/房屋面积/物业费起始时间为必填项（身份证可选）');
    }
    const project = await this.projectRepo.findOne({ where: { id: input.projectId, companyId } });
    if (!project) {
      throw new BusinessException(ErrorCodes.VALIDATION_FAILED, '所属项目不存在');
    }

    const houseAreaFen = Math.round(input.houseArea * 100);
    if (houseAreaFen <= 0 || !Number.isFinite(input.houseArea) || Math.abs(input.houseArea * 100 - houseAreaFen) > 1e-9) {
      throw new BusinessException(ErrorCodes.HOUSE_AREA_INVALID, '房屋面积必须大于 0 且最多两位小数');
    }

    const exists = await this.customerRepo.findOne({
      where: { companyId, projectId: input.projectId, roomNo: input.roomNo },
    });
    if (exists && !exists.deletedAt) {
      throw new BusinessException(ErrorCodes.ROOM_NO_DUP);
    }

    const person = await this.ensurePerson(companyId, {
      name: input.name,
      phone: input.phone,
      idCard: input.idCard,
    });
    const extJson = input.ext ? await this.validateExt(companyId, input.ext) : undefined;
    const residentType = input.residentType ?? ResidentType.OWNER;
    const propertyType = normalizePropertyType(input.propertyType);

    const customer = await this.customerRepo.save(
      this.customerRepo.create({
        companyId,
        projectId: input.projectId,
        personId: person.id,
        residentType,
        propertyType,
        name: person.name,
        phoneEncrypted: person.phoneEncrypted,
        phoneBlindIndex: person.phoneBlindIndex,
        roomNo: input.roomNo,
        idCardEncrypted: person.idCardEncrypted,
        idCardBlindIndex: person.idCardBlindIndex,
        houseArea: houseAreaFen,
        contractDate: input.contractDate,
        feeStartDate: input.feeStartDate,
        decorateDate: input.decorateDate,
        houseStatus: input.houseStatus,
        ext: extJson ? JSON.stringify(extJson) : undefined,
      }),
    );
    if (input.paidMonths && input.paidMonths > 0) {
      await this.writeOpeningPaidMonths(companyId, customer, input.paidMonths);
    }
    return this.toView(customer, project.name);
  }

  /** 期初已缴月数：从物业费起始月起写一条 effective 台账（无收款单） */
  private async writeOpeningPaidMonths(companyId: number, customer: CustomerEntity, paidMonths: number) {
    const startMonth = FeeCalculationService.monthOf(customer.feeStartDate);
    const endMonth = FeeCalculationService.addMonths(startMonth, paidMonths - 1);
    const pt = normalizePropertyType(customer.propertyType);
    const unitCode =
      pt === PropertyType.COMMERCIAL_L2
        ? FeeParameterCode.PROPERTY_FEE_UNIT_PRICE_COMMERCIAL_L2
        : pt === PropertyType.COMMERCIAL_L1
          ? FeeParameterCode.PROPERTY_FEE_UNIT_PRICE_COMMERCIAL
          : FeeParameterCode.PROPERTY_FEE_UNIT_PRICE;
    let unitPrice: number;
    try {
      unitPrice = await this.feeParameterService.resolveOne(companyId, unitCode, customer.projectId);
    } catch {
      unitPrice = await this.feeParameterService.resolveOne(
        companyId,
        FeeParameterCode.PROPERTY_FEE_UNIT_PRICE,
        customer.projectId,
      );
    }
    await this.ledgerRepo.save(
      this.ledgerRepo.create({
        companyId,
        customerId: customer.id,
        receiptOrderId: null,
        startMonth,
        endMonth,
        months: paidMonths,
        unitPriceSnapshot: unitPrice,
        areaSnapshot: customer.houseArea,
        status: LedgerStatus.EFFECTIVE,
      }),
    );
  }

  /**
   * Excel 批量导入客户（期初数据）：
   * 支持项目编号/项目名称、房号、姓名、手机、身份证、面积、物业费起始日、已缴月数等。
   */
  async importBatch(
    companyId: number,
    input: {
      defaultProjectId?: number;
      confirmProfile?: boolean;
      rows: Array<Record<string, unknown>>;
    },
  ) {
    const projects = await this.projectRepo.find({ where: { companyId } });
    const byId = new Map(projects.map((p) => [p.id, p]));
    const byName = new Map(projects.map((p) => [p.name.trim(), p]));

    const success: { row: number; roomNo: string; customerId: number }[] = [];
    const failed: { row: number; roomNo?: string; reason: string }[] = [];

    for (let i = 0; i < input.rows.length; i++) {
      const raw = input.rows[i];
      const rowNo = i + 2; // 模板含表头，Excel 行号从 2 起
      try {
        const mapped = this.mapImportRow(raw);
        if (!mapped.roomNo && !mapped.name && !mapped.phone) continue; // 空行跳过

        let projectId = mapped.projectId ?? input.defaultProjectId;
        if (!projectId && mapped.projectName) {
          projectId = byName.get(mapped.projectName.trim())?.id;
        }
        if (!projectId || !byId.has(projectId)) {
          throw new Error('项目不存在，请填写项目编号或准确的项目名称');
        }

        const created = await this.create({
          projectId,
          name: mapped.name,
          phone: mapped.phone,
          roomNo: mapped.roomNo,
          idCard: mapped.idCard,
          houseArea: mapped.houseArea,
          feeStartDate: mapped.feeStartDate,
          contractDate: mapped.contractDate,
          decorateDate: mapped.decorateDate,
          houseStatus: mapped.houseStatus,
          residentType: mapped.residentType,
          propertyType: mapped.propertyType,
          paidMonths: mapped.paidMonths,
        });

        if (input.confirmProfile && created.id) {
          const customer = await this.customerRepo.findOne({ where: { id: created.id, companyId } });
          if (customer && !customer.profileConfirmedAt) {
            customer.profileConfirmedAt = new Date().toISOString();
            await this.customerRepo.save(customer);
          }
        }

        success.push({ row: rowNo, roomNo: mapped.roomNo, customerId: created.id });
      } catch (e: unknown) {
        let reason = '导入失败';
        if (e instanceof BusinessException) {
          const body = e.getResponse();
          reason =
            typeof body === 'object' && body && 'message' in body
              ? String((body as { message: string }).message)
              : e.message;
        } else if (e instanceof Error) {
          reason = e.message;
        }
        failed.push({
          row: rowNo,
          roomNo: String(raw['房号'] ?? raw['roomNo'] ?? ''),
          reason,
        });
      }
    }

    return {
      total: input.rows.length,
      successCount: success.length,
      failedCount: failed.length,
      success,
      failed,
    };
  }

  private mapImportRow(raw: Record<string, unknown>) {
    const get = (...keys: string[]) => {
      for (const k of keys) {
        if (raw[k] !== undefined && raw[k] !== null && String(raw[k]).trim() !== '') return raw[k];
      }
      return undefined;
    };

    const projectIdRaw = get('项目编号', '项目ID', 'projectId');
    const projectName = String(get('项目名称', 'projectName') ?? '').trim();
    const roomNo = String(get('房号', 'roomNo') ?? '').trim();
    const name = String(get('姓名', 'name') ?? '').trim();
    const phone = String(get('手机号', '电话', 'phone') ?? '').trim();
    const idCardRaw = String(get('身份证号', '身份证', 'idCard') ?? '')
      .trim()
      .toUpperCase();
    const idCard = idCardRaw || undefined;
    const houseArea = Number(get('房屋面积', '面积', 'houseArea') ?? 0);
    const feeStartDate = this.normalizeImportDate(get('物业费起始日期', '物业费起始时间', 'feeStartDate'));
    const paidMonths = Number(get('已缴月数', '期初已缴月数', 'paidMonths') ?? 0);
    const contractDate = this.normalizeImportDate(get('合同日期', '合同签约时间', 'contractDate'), true);
    const decorateDate = this.normalizeImportDate(get('装修日期', '装修时间', 'decorateDate'), true);
    const houseStatus = this.parseHouseStatus(String(get('房屋状态', 'houseStatus') ?? '未装修'));
    const residentType = this.parseResidentType(String(get('住户类型', '身份', 'residentType') ?? '业主'));
    const propertyType = this.parsePropertyType(String(get('房屋性质', '物业类型', 'propertyType') ?? '住房'));

    if (!roomNo || !name || !phone || !houseArea || !feeStartDate) {
      throw new Error('必填项不完整（房号/姓名/手机号/房屋面积/物业费起始日期；身份证可选）');
    }
    if (paidMonths < 0 || !Number.isFinite(paidMonths)) {
      throw new Error('已缴月数须为 ≥0 的整数');
    }

    return {
      projectId: projectIdRaw ? Number(projectIdRaw) : undefined,
      projectName: projectName || undefined,
      roomNo,
      name,
      phone,
      idCard,
      houseArea,
      feeStartDate,
      paidMonths: Math.floor(paidMonths),
      contractDate,
      decorateDate,
      houseStatus,
      residentType,
      propertyType,
    };
  }

  private normalizeImportDate(v: unknown, optional = false): string | undefined {
    if (v === undefined || v === null || String(v).trim() === '') {
      if (optional) return undefined;
      throw new Error('日期不能为空');
    }
    if (typeof v === 'number' && Number.isFinite(v)) {
      // Excel 序列日
      const epoch = new Date(Date.UTC(1899, 11, 30));
      const d = new Date(epoch.getTime() + v * 86400000);
      return d.toISOString().slice(0, 10);
    }
    const s = String(v).trim().replace(/\//g, '-');
    if (/^\d{4}-\d{2}$/.test(s)) return `${s}-01`;
    if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
    const parsed = new Date(s);
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString().slice(0, 10);
    throw new Error(`无法识别的日期：${s}`);
  }

  private parseHouseStatus(label: string): HouseStatus {
    const map: Record<string, HouseStatus> = {
      未交房: HouseStatus.UNDELIVERED,
      UNDELIVERED: HouseStatus.UNDELIVERED,
      未装修: HouseStatus.UNDECORATED,
      UNDECORATED: HouseStatus.UNDECORATED,
      已装修: HouseStatus.DECORATED,
      DECORATED: HouseStatus.DECORATED,
      已交房: HouseStatus.UNDECORATED,
      DELIVERED: HouseStatus.UNDECORATED,
      装修中: HouseStatus.DECORATED,
      DECORATING: HouseStatus.DECORATED,
      入住: HouseStatus.DECORATED,
      已入住: HouseStatus.DECORATED,
      OCCUPIED: HouseStatus.DECORATED,
      空置: HouseStatus.UNDECORATED,
      VACANT: HouseStatus.UNDECORATED,
    };
    return normalizeHouseStatus(map[label.trim()] ?? HouseStatus.UNDECORATED);
  }

  private parseResidentType(label: string): ResidentType {
    const map: Record<string, ResidentType> = {
      业主: ResidentType.OWNER,
      OWNER: ResidentType.OWNER,
      租户: ResidentType.TENANT,
      TENANT: ResidentType.TENANT,
    };
    return map[label.trim()] ?? ResidentType.OWNER;
  }

  private parsePropertyType(label: string): PropertyType {
    const map: Record<string, PropertyType> = {
      住房: PropertyType.RESIDENTIAL,
      住宅: PropertyType.RESIDENTIAL,
      RESIDENTIAL: PropertyType.RESIDENTIAL,
      商户: PropertyType.COMMERCIAL_L1,
      门面: PropertyType.COMMERCIAL_L1,
      商铺: PropertyType.COMMERCIAL_L1,
      门面一楼: PropertyType.COMMERCIAL_L1,
      一楼门面: PropertyType.COMMERCIAL_L1,
      一楼: PropertyType.COMMERCIAL_L1,
      COMMERCIAL: PropertyType.COMMERCIAL_L1,
      COMMERCIAL_L1: PropertyType.COMMERCIAL_L1,
      门面二楼: PropertyType.COMMERCIAL_L2,
      二楼门面: PropertyType.COMMERCIAL_L2,
      二楼: PropertyType.COMMERCIAL_L2,
      COMMERCIAL_L2: PropertyType.COMMERCIAL_L2,
    };
    return normalizePropertyType(map[label.trim()] ?? PropertyType.RESIDENTIAL);
  }

  /** 分页查询：项目/房号/姓名/手机/身份证盲索引 */
  async list(
    companyId: number,
    query: {
      projectId?: number;
      roomNo?: string;
      name?: string;
      phone?: string;
      idCard?: string;
      residentType?: string;
      propertyType?: string;
      page?: number;
      pageSize?: number;
    },
  ) {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const qb = this.customerRepo
      .createQueryBuilder('c')
      .where('c.companyId = :companyId', { companyId })
      .andWhere('c.deletedAt IS NULL')
      .orderBy('c.createdAt', 'DESC')
      .skip((page - 1) * pageSize)
      .take(pageSize);
    if (query.projectId) qb.andWhere('c.projectId = :projectId', { projectId: query.projectId });
    if (query.roomNo) qb.andWhere('c.roomNo = :roomNo', { roomNo: query.roomNo });
    if (query.name) qb.andWhere('c.name = :name', { name: query.name });
    if (query.phone) qb.andWhere('c.phoneBlindIndex = :phoneIdx', { phoneIdx: this.crypto.blindIndex(query.phone) });
    if (query.idCard) {
      qb.andWhere('c.idCardBlindIndex = :idCardIdx', {
        idCardIdx: this.crypto.blindIndex(query.idCard.trim().toUpperCase()),
      });
    }
    if (query.residentType) qb.andWhere('c.residentType = :residentType', { residentType: query.residentType });
    if (query.propertyType) qb.andWhere('c.propertyType = :propertyType', { propertyType: query.propertyType });
    const [list, total] = await qb.getManyAndCount();
    const projectIds = [...new Set(list.map((c) => c.projectId))];
    const projects = projectIds.length ? await this.projectRepo.find({ where: { id: In(projectIds) } }) : [];
    const projectNameMap = new Map(projects.map((p) => [p.id, p.name]));
    return {
      list: list.map((c) => this.toSummary(c, projectNameMap.get(c.projectId))),
      total,
      page,
      pageSize,
    };
  }

  /** 按身份证查询该人在公司下全部房源（跨项目） */
  async listByIdCard(companyId: number, idCard: string) {
    if (!isValidIdCard(idCard.trim().toUpperCase())) {
      throw new BusinessException(ErrorCodes.ID_CARD_INVALID);
    }
    const blind = this.crypto.blindIndex(idCard.trim().toUpperCase());
    const person = await this.personRepo.findOne({ where: { companyId, idCardBlindIndex: blind } });
    if (!person) {
      return { person: null, properties: [] as ReturnType<CustomerService['toSummary']>[] };
    }
    const customers = await this.customerRepo.find({
      where: { companyId, personId: person.id },
      order: { projectId: 'ASC', roomNo: 'ASC' },
    });
    const active = customers.filter((c) => !c.deletedAt);
    const projectIdList = [...new Set(active.map((c) => c.projectId))];
    const projects = projectIdList.length ? await this.projectRepo.find({ where: { id: In(projectIdList) } }) : [];
    const projectNameMap = new Map(projects.map((p) => [p.id, p.name]));
    return {
      person: {
        id: person.id,
        name: person.name,
        phoneMasked: CryptoService.maskPhone(this.crypto.decrypt(person.phoneEncrypted)),
        idCardMasked: person.idCardEncrypted
          ? CryptoService.maskIdCard(this.crypto.decrypt(person.idCardEncrypted))
          : '',
      },
      properties: active.map((c) => this.toSummary(c, projectNameMap.get(c.projectId))),
    };
  }

  async detail(companyId: number, id: number) {
    const customer = await this.getOrThrow(companyId, id);
    const plates = await this.plateRepo.find({ where: { customerId: id } });
    const project = await this.projectRepo.findOne({ where: { id: customer.projectId, companyId } });
    const siblings =
      customer.personId != null
        ? (
            await this.customerRepo.find({
              where: { companyId, personId: customer.personId },
            })
          ).filter((c) => !c.deletedAt && c.id !== customer.id)
        : [];
    const siblingProjectIds = [...new Set(siblings.map((c) => c.projectId))];
    const siblingProjects = siblingProjectIds.length
      ? await this.projectRepo.find({ where: { id: In(siblingProjectIds) } })
      : [];
    const siblingProjectMap = new Map(siblingProjects.map((p) => [p.id, p.name]));
    const ownershipHistory = await this.ownershipRepo.find({
      where: { companyId, customerId: id },
      order: { transferredAt: 'DESC' },
    });
    const decorateFilings = await this.decorateRepo.find({
      where: { companyId, customerId: id },
      order: { createdAt: 'DESC' },
    });
    const activeFiling = decorateFilings.find((f) => f.status === 'active');
    const view = this.toView(customer, project?.name);
    return {
      ...view,
      plates: plates.map((p) => p.plateNo),
      relatedProperties: siblings.map((c) => this.toSummary(c, siblingProjectMap.get(c.projectId))),
      ownershipHistory,
      decorateFilings,
      activeDecorateFiling: activeFiling ?? null,
      vacantEligible: isVacantDiscountEligible(customer.houseStatus),
      depositDeductAllowed: !!activeFiling,
    };
  }

  async confirmProfile(companyId: number, userId: number, id: number) {
    const customer = await this.getOrThrow(companyId, id);
    if (customer.profileConfirmedAt) {
      throw new BusinessException(ErrorCodes.VALIDATION_FAILED, '该客户档案已确认');
    }
    customer.profileConfirmedAt = new Date().toISOString();
    customer.profileUnlockUntil = undefined;
    await this.customerRepo.save(customer);
    await this.changeLogRepo.save(
      this.changeLogRepo.create({
        companyId,
        customerId: id,
        operatorId: userId,
        fieldName: '档案确认',
        oldValue: '',
        newValue: customer.profileConfirmedAt,
        changedAt: customer.profileConfirmedAt,
      }),
    );
    const project = await this.projectRepo.findOne({ where: { id: customer.projectId } });
    return this.toView(customer, project?.name);
  }

  async unlockProfile(companyId: number, userId: number, id: number) {
    const customer = await this.getOrThrow(companyId, id);
    if (!customer.profileConfirmedAt) {
      throw new BusinessException(ErrorCodes.VALIDATION_FAILED, '档案尚未确认，无需解锁');
    }
    const until = new Date(Date.now() + PROFILE_UNLOCK_TTL_MS).toISOString();
    customer.profileUnlockUntil = until;
    await this.customerRepo.save(customer);
    await this.changeLogRepo.save(
      this.changeLogRepo.create({
        companyId,
        customerId: id,
        operatorId: userId,
        fieldName: '档案解锁',
        oldValue: '',
        newValue: until,
        changedAt: new Date().toISOString(),
      }),
    );
    const project = await this.projectRepo.findOne({ where: { id: customer.projectId } });
    return this.toView(customer, project?.name);
  }

  /**
   * 房屋转售：仅换绑业主身份（姓名/手机/证件），台账/收据仍挂本房源 customerId。
   * 不改变房屋状态、交房日期、物业费起算；未交房也可更正业主信息，但不会因此变成已交房。
   */
  async resale(
    companyId: number,
    userId: number,
    id: number,
    input: {
      name: string;
      phone: string;
      idCard?: string;
      residentType?: ResidentType;
      contractDate?: string;
      remark?: string;
    },
  ) {
    const customer = await this.getOrThrow(companyId, id);
    const fromName = customer.name;
    const fromIdCardMasked = this.maskIdCardSafe(customer.idCardEncrypted);
    const fromPersonId = customer.personId;
    const person = await this.ensurePerson(companyId, {
      name: input.name,
      phone: input.phone,
      idCard: input.idCard,
    });
    const toIdCardMasked = this.maskIdCardSafe(person.idCardEncrypted);
    await this.ownershipRepo.save(
      this.ownershipRepo.create({
        companyId,
        customerId: id,
        fromPersonId,
        toPersonId: person.id,
        fromName,
        fromIdCardMasked,
        toName: person.name,
        toIdCardMasked,
        transferredAt: new Date().toISOString(),
        operatorId: userId,
        remark: input.remark,
      }),
    );
    customer.personId = person.id;
    customer.name = person.name;
    customer.phoneEncrypted = person.phoneEncrypted;
    customer.phoneBlindIndex = person.phoneBlindIndex;
    customer.idCardEncrypted = person.idCardEncrypted;
    customer.idCardBlindIndex = person.idCardBlindIndex;
    if (input.residentType) customer.residentType = input.residentType;
    if (input.contractDate !== undefined) customer.contractDate = input.contractDate;
    // 新业主需重新确认档案
    customer.profileConfirmedAt = undefined;
    customer.profileUnlockUntil = undefined;
    await this.customerRepo.save(customer);
    await this.changeLogRepo.save(
      this.changeLogRepo.create({
        companyId,
        customerId: id,
        operatorId: userId,
        fieldName: '房屋转售',
        oldValue: fromName,
        newValue: person.name,
        changedAt: new Date().toISOString(),
      }),
    );
    const project = await this.projectRepo.findOne({ where: { id: customer.projectId } });
    return this.toView(customer, project?.name);
  }

  async listDecorateFilings(companyId: number, customerId: number) {
    await this.getOrThrow(companyId, customerId);
    return this.decorateRepo.find({
      where: { companyId, customerId },
      order: { createdAt: 'DESC' },
    });
  }

  async createDecorateFiling(
    companyId: number,
    userId: number,
    customerId: number,
    input: { startDate: string; endDate?: string; remark?: string },
  ) {
    const customer = await this.getOrThrow(companyId, customerId);
    if (!input.startDate) {
      throw new BusinessException(ErrorCodes.VALIDATION_FAILED, '装修开始日期必填');
    }
    // 关闭既有 active
    const actives = await this.decorateRepo.find({ where: { companyId, customerId, status: 'active' } });
    for (const a of actives) {
      a.status = 'closed';
      if (!a.endDate) a.endDate = input.startDate;
      await this.decorateRepo.save(a);
    }
    const filing = await this.decorateRepo.save(
      this.decorateRepo.create({
        companyId,
        customerId,
        startDate: input.startDate,
        endDate: input.endDate,
        status: 'active',
        remark: input.remark,
        createdBy: userId,
      }),
    );
    customer.decorateDate = input.startDate;
    // 装修报备后：未装修 → 已装修（未交房须先交房缴费）
    const before = normalizeHouseStatus(customer.houseStatus);
    if (before === HouseStatus.UNDECORATED) {
      const from = customer.houseStatus;
      customer.houseStatus = HouseStatus.DECORATED;
      await this.changeLogRepo.save(
        this.changeLogRepo.create({
          companyId,
          customerId,
          operatorId: userId,
          fieldName: '房屋状态',
          oldValue: from,
          newValue: HouseStatus.DECORATED,
          changedAt: new Date().toISOString(),
        }),
      );
    }
    await this.customerRepo.save(customer);
    return filing;
  }

  async closeDecorateFiling(companyId: number, customerId: number, filingId: number, endDate?: string) {
    await this.getOrThrow(companyId, customerId);
    const filing = await this.decorateRepo.findOne({ where: { id: filingId, companyId, customerId } });
    if (!filing) throw new BusinessException(ErrorCodes.VALIDATION_FAILED, '装修报备不存在');
    filing.status = 'closed';
    filing.endDate = endDate ?? new Date().toISOString().slice(0, 10);
    return this.decorateRepo.save(filing);
  }

  /** 是否存在有效装修报备（押金抵扣前提） */
  async hasActiveDecorateFiling(companyId: number, customerId: number): Promise<boolean> {
    const n = await this.decorateRepo.count({ where: { companyId, customerId, status: 'active' } });
    return n > 0;
  }

  /** 客户修改（自动留痕：字段名/旧值/新值，敏感字段脱敏存留） */
  async update(companyId: number, userId: number, id: number, patch: Record<string, unknown>) {
    const customer = await this.getOrThrow(companyId, id);
    const locked = this.isProfileLocked(customer);
    const touchingProtected = Object.keys(patch).some((k) => PROTECTED_PROFILE_FIELDS.has(k) && patch[k] !== undefined);
    if (locked && touchingProtected) {
      throw new BusinessException(
        ErrorCodes.FORBIDDEN,
        '档案已确认锁定，请先由授权人员解锁后再修改核心信息',
      );
    }
    const trackable: Record<string, unknown> = {};
    const allowedFields: { [k: string]: (v: unknown) => void } = {
      name: (v) => {
        trackable['name'] = v;
        customer.name = String(v);
      },
      phone: (v) => {
        const phone = String(v);
        if (!isValidPhone(phone)) throw new BusinessException(ErrorCodes.VALIDATION_FAILED, '电话须为国内手机号格式');
        trackable['phone'] = phone;
        customer.phoneEncrypted = this.crypto.encrypt(phone);
        customer.phoneBlindIndex = this.crypto.blindIndex(phone);
      },
      idCard: (v) => {
        const idCard = String(v ?? '').trim().toUpperCase();
        if (!idCard) {
          trackable['idCard'] = '';
          customer.idCardEncrypted = undefined;
          customer.idCardBlindIndex = undefined;
          return;
        }
        if (!isValidIdCard(idCard)) throw new BusinessException(ErrorCodes.ID_CARD_INVALID);
        trackable['idCard'] = idCard;
        customer.idCardEncrypted = this.crypto.encrypt(idCard);
        customer.idCardBlindIndex = this.crypto.blindIndex(idCard);
      },
      residentType: (v) => {
        const type = String(v);
        if (!Object.values(ResidentType).includes(type as ResidentType)) {
          throw new BusinessException(ErrorCodes.VALIDATION_FAILED, '住户类型须为 OWNER 或 TENANT');
        }
        trackable['residentType'] = type;
        customer.residentType = type;
      },
      propertyType: (v) => {
        const type = normalizePropertyType(String(v));
        trackable['propertyType'] = type;
        customer.propertyType = type;
      },
      houseArea: (v) => {
        const area = Number(v);
        const areaFen = Math.round(area * 100);
        if (areaFen <= 0) throw new BusinessException(ErrorCodes.HOUSE_AREA_INVALID);
        trackable['houseArea'] = area;
        customer.houseArea = areaFen;
      },
      contractDate: (v) => {
        trackable['contractDate'] = v;
        customer.contractDate = String(v);
      },
      feeStartDate: (v) => {
        trackable['feeStartDate'] = v;
        customer.feeStartDate = String(v);
      },
      decorateDate: (v) => {
        trackable['decorateDate'] = v;
        customer.decorateDate = String(v);
      },
    };
    const oldSnapshot: Record<string, unknown> = {
      name: customer.name,
      phone: CryptoService.maskPhone(this.crypto.decrypt(customer.phoneEncrypted)),
      idCard: this.maskIdCardSafe(customer.idCardEncrypted),
      residentType: customer.residentType,
      propertyType: normalizePropertyType(customer.propertyType),
      houseArea: customer.houseArea / 100,
      contractDate: customer.contractDate,
      feeStartDate: customer.feeStartDate,
      decorateDate: customer.decorateDate,
    };
    for (const [key, value] of Object.entries(patch)) {
      if (key === 'houseStatus') continue;
      if (key === 'ext') continue;
      const handler = allowedFields[key];
      if (handler) handler(value);
    }

    // 身份信息变更时重建/关联自然人（以手机号为主键）
    if (trackable['idCard'] !== undefined || trackable['name'] || trackable['phone'] || trackable['propertyType']) {
      const plainIdCard = customer.idCardEncrypted ? this.crypto.decrypt(customer.idCardEncrypted) : undefined;
      const plainPhone = this.crypto.decrypt(customer.phoneEncrypted);
      const person = await this.ensurePerson(companyId, {
        name: customer.name,
        phone: plainPhone,
        idCard: plainIdCard,
      });
      customer.personId = person.id;
      customer.idCardEncrypted = person.idCardEncrypted;
      customer.idCardBlindIndex = person.idCardBlindIndex;
      customer.phoneEncrypted = person.phoneEncrypted;
      customer.phoneBlindIndex = person.phoneBlindIndex;
      customer.name = person.name;
    }

    // 解锁窗口：成功修改核心字段后立即重新上锁
    if (customer.profileConfirmedAt && touchingProtected && Object.keys(trackable).length > 0) {
      customer.profileUnlockUntil = undefined;
    }

    await this.customerRepo.save(customer);

    const newSnapshot: Record<string, unknown> = {
      name: customer.name,
      phone: CryptoService.maskPhone(this.crypto.decrypt(customer.phoneEncrypted)),
      idCard: this.maskIdCardSafe(customer.idCardEncrypted),
      residentType: customer.residentType,
      propertyType: normalizePropertyType(customer.propertyType),
      houseArea: customer.houseArea / 100,
      contractDate: customer.contractDate,
      feeStartDate: customer.feeStartDate,
      decorateDate: customer.decorateDate,
    };
    const changedAt = new Date().toISOString();
    for (const key of Object.keys(trackable)) {
      await this.changeLogRepo.save(
        this.changeLogRepo.create({
          companyId,
          customerId: id,
          operatorId: userId,
          fieldName: key,
          oldValue: String(oldSnapshot[key] ?? ''),
          newValue: SENSITIVE_FIELDS.has(key) ? String(newSnapshot[key]) : String(trackable[key]),
          changedAt,
        }),
      );
    }
    const project = await this.projectRepo.findOne({ where: { id: customer.projectId } });
    return this.toView(customer, project?.name);
  }

  async transitionStatus(
    companyId: number,
    userId: number,
    customerId: number,
    target: HouseStatus,
  ): Promise<CustomerEntity> {
    const customer = await this.getOrThrow(companyId, customerId);
    const current = customer.houseStatus as HouseStatus;
    const normalized = normalizeHouseStatus(current);
    const normalizedTarget = normalizeHouseStatus(target);
    if (normalized === HouseStatus.UNDELIVERED) {
      throw new BusinessException(
        ErrorCodes.STATUS_TRANSITION_INVALID,
        '未交房状态仅能通过交房缴费变更为未装修',
      );
    }
    if (normalizedTarget === HouseStatus.UNDELIVERED) {
      throw new BusinessException(ErrorCodes.STATUS_TRANSITION_INVALID, '不可手工改回未交房');
    }
    const allowed = (HouseStatusTransitionMatrix[normalized] ?? []).map(normalizeHouseStatus);
    if (!allowed.includes(normalizedTarget)) {
      throw new BusinessException(ErrorCodes.STATUS_TRANSITION_INVALID);
    }
    customer.houseStatus = normalizedTarget;
    await this.customerRepo.save(customer);
    await this.changeLogRepo.save(
      this.changeLogRepo.create({
        companyId,
        customerId,
        operatorId: userId,
        fieldName: '房屋状态',
        oldValue: current,
        newValue: target,
        changedAt: new Date().toISOString(),
      }),
    );
    return customer;
  }

  async addPlate(companyId: number, customerId: number, plateNo: string) {
    await this.getOrThrow(companyId, customerId);
    if (!isValidPlateNo(plateNo)) {
      throw new BusinessException(ErrorCodes.VALIDATION_FAILED, '车牌号格式不正确');
    }
    const exists = await this.plateRepo.findOne({ where: { customerId, plateNo } });
    if (exists) {
      throw new BusinessException(ErrorCodes.VALIDATION_FAILED, '该车牌已登记');
    }
    return this.plateRepo.save(this.plateRepo.create({ companyId, customerId, plateNo }));
  }

  async delete(companyId: number, id: number) {
    const customer = await this.getOrThrow(companyId, id);
    const receipt = await this.receiptRepo.findOne({ where: { companyId, customerId: id } });
    if (receipt) {
      throw new BusinessException(ErrorCodes.VALIDATION_FAILED, '该客户已有缴费记录，禁止删除');
    }
    customer.deletedAt = new Date().toISOString();
    await this.customerRepo.save(customer);
  }

  async changeLogs(companyId: number, customerId: number, page = 1, pageSize = 20) {
    const [list, total] = await this.changeLogRepo.findAndCount({
      where: { companyId, customerId },
      order: { changedAt: 'DESC' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    });
    return { list, total, page, pageSize };
  }

  async getOrThrow(companyId: number, id: number): Promise<CustomerEntity> {
    if (!Number.isFinite(id) || id <= 0) {
      throw new BusinessException(ErrorCodes.VALIDATION_FAILED, '客户编号无效');
    }
    const customer = await this.customerRepo.findOne({ where: { id, companyId } });
    if (!customer || customer.deletedAt) {
      throw new BusinessException(ErrorCodes.ROOM_NO_NOT_FOUND, '客户档案不存在');
    }
    return customer;
  }

  async getByRoomNo(companyId: number, projectId: number, roomNo: string): Promise<CustomerEntity> {
    const customer = await this.customerRepo.findOne({ where: { companyId, projectId, roomNo } });
    if (!customer || customer.deletedAt) {
      throw new BusinessException(ErrorCodes.ROOM_NO_NOT_FOUND);
    }
    return customer;
  }

  async registerExtKey(
    companyId: number,
    keyName: string,
    displayName: string,
    valueType: string,
    required: boolean,
    validationRule?: string,
  ) {
    const exists = await this.extKeyRepo.findOne({ where: { companyId, keyName } });
    if (exists) throw new BusinessException(ErrorCodes.VALIDATION_FAILED, '扩展字段键名已存在');
    return this.extKeyRepo.save(this.extKeyRepo.create({ companyId, keyName, displayName, valueType, required, validationRule }));
  }

  async listExtKeys(companyId: number) {
    return this.extKeyRepo.find({ where: { companyId } });
  }

  /** 存量档案回填 person_id（启动幂等） */
  async backfillPersons(companyId?: number): Promise<number> {
    const qb = this.customerRepo.createQueryBuilder('c').where('c.deletedAt IS NULL').andWhere('(c.personId IS NULL OR c.personId = 0)');
    if (companyId) qb.andWhere('c.companyId = :companyId', { companyId });
    const orphans = await qb.getMany();
    let count = 0;
    for (const c of orphans) {
      try {
        const idCard = c.idCardEncrypted ? this.crypto.decrypt(c.idCardEncrypted) : undefined;
        const phone = this.crypto.decrypt(c.phoneEncrypted);
        const person = await this.ensurePerson(c.companyId, { name: c.name, phone, idCard });
        c.personId = person.id;
        if (!c.residentType) c.residentType = ResidentType.OWNER;
        if (!c.propertyType) c.propertyType = PropertyType.RESIDENTIAL;
        await this.customerRepo.save(c);
        count += 1;
      } catch {
        // 跳过无法解密/校验的脏数据
      }
    }
    return count;
  }

  private async validateExt(companyId: number, ext: Record<string, unknown>): Promise<Record<string, unknown>> {
    const keys = await this.extKeyRepo.find({ where: { companyId } });
    const result: Record<string, unknown> = {};
    for (const reg of keys) {
      const value = ext[reg.keyName];
      if (value === undefined || value === null || value === '') {
        if (reg.required) {
          throw new BusinessException(ErrorCodes.VALIDATION_FAILED, `扩展字段「${reg.displayName}」为必填项`);
        }
        continue;
      }
      if (reg.valueType === 'number' && Number.isNaN(Number(value))) {
        throw new BusinessException(ErrorCodes.VALIDATION_FAILED, `扩展字段「${reg.displayName}」须为数字`);
      }
      result[reg.keyName] = value;
    }
    return result;
  }

  private maskIdCardSafe(encrypted?: string | null): string {
    if (!encrypted) return '';
    try {
      return CryptoService.maskIdCard(this.crypto.decrypt(encrypted));
    } catch {
      return '';
    }
  }

  toSummary(c: CustomerEntity, projectName?: string) {
    return {
      id: c.id,
      personId: c.personId,
      name: c.name,
      roomNo: c.roomNo,
      houseAreaFen: c.houseArea,
      houseStatus: c.houseStatus,
      projectId: c.projectId,
      projectName: projectName ?? '',
      residentType: c.residentType ?? ResidentType.OWNER,
      propertyType: normalizePropertyType(c.propertyType),
      idCardMasked: this.maskIdCardSafe(c.idCardEncrypted),
    };
  }

  toView(c: CustomerEntity, projectName?: string) {
    const locked = this.isProfileLocked(c);
    return {
      id: c.id,
      personId: c.personId,
      projectId: c.projectId,
      projectName: projectName ?? '',
      residentType: c.residentType ?? ResidentType.OWNER,
      propertyType: normalizePropertyType(c.propertyType),
      name: c.name,
      roomNo: c.roomNo,
      phoneMasked: CryptoService.maskPhone(this.crypto.decrypt(c.phoneEncrypted)),
      idCardMasked: this.maskIdCardSafe(c.idCardEncrypted),
      houseAreaFen: c.houseArea,
      houseStatus: c.houseStatus,
      contractDate: c.contractDate,
      feeStartDate: c.feeStartDate,
      decorateDate: c.decorateDate,
      deliveryDate: c.deliveryDate,
      profileConfirmedAt: c.profileConfirmedAt ?? null,
      profileUnlockUntil: c.profileUnlockUntil ?? null,
      profileLocked: locked,
      ext: c.ext ? JSON.parse(c.ext) : undefined,
    };
  }
}
