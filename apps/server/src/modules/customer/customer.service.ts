import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { ErrorCodes, HouseStatus, HouseStatusTransitionMatrix, ResidentType } from '@pms/shared';
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
import { ReceiptOrderEntity } from '../../database/entities/charging-entities';

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
    @InjectRepository(ExtKeyRegistryEntity) private readonly extKeyRepo: Repository<ExtKeyRegistryEntity>,
    private readonly tenantService: TenantService,
  ) {}

  isProfileLocked(customer: CustomerEntity): boolean {
    if (!customer.profileConfirmedAt) return false;
    if (customer.profileUnlockUntil && new Date(customer.profileUnlockUntil).getTime() > Date.now()) {
      return false;
    }
    return true;
  }

  /**
   * 按身份证 upsert 自然人：公司内身份证唯一。
   * 同一人可绑定多个项目/房号的房屋档案。
   */
  async ensurePerson(companyId: number, input: { name: string; phone: string; idCard: string }): Promise<PersonEntity> {
    const idCard = input.idCard.trim().toUpperCase();
    if (!idCard) throw new BusinessException(ErrorCodes.ID_CARD_REQUIRED);
    if (!isValidIdCard(idCard)) throw new BusinessException(ErrorCodes.ID_CARD_INVALID);
    if (!isValidPhone(input.phone)) {
      throw new BusinessException(ErrorCodes.VALIDATION_FAILED, '电话须为国内手机号格式');
    }

    const blind = this.crypto.blindIndex(idCard);
    let person = await this.personRepo.findOne({ where: { companyId, idCardBlindIndex: blind } });
    if (!person) {
      person = await this.personRepo.save(
        this.personRepo.create({
          companyId,
          name: input.name,
          phoneEncrypted: this.crypto.encrypt(input.phone),
          phoneBlindIndex: this.crypto.blindIndex(input.phone),
          idCardEncrypted: this.crypto.encrypt(idCard),
          idCardBlindIndex: blind,
        }),
      );
      return person;
    }

    // 已存在：姓名必须一致，电话可更新
    if (person.name !== input.name) {
      throw new BusinessException(ErrorCodes.ID_CARD_PERSON_MISMATCH);
    }
    const phoneBlind = this.crypto.blindIndex(input.phone);
    if (person.phoneBlindIndex !== phoneBlind) {
      person.phoneEncrypted = this.crypto.encrypt(input.phone);
      person.phoneBlindIndex = phoneBlind;
      person = await this.personRepo.save(person);
    }
    return person;
  }

  /** 客户档案创建（身份证 → 自然人唯一身份；同项目房号唯一；跨项目可同人多房） */
  async create(input: {
    projectId: number;
    name: string;
    phone: string;
    roomNo: string;
    idCard: string;
    houseArea: number;
    contractDate?: string;
    feeStartDate: string;
    decorateDate?: string;
    houseStatus: HouseStatus;
    residentType?: ResidentType;
    ext?: Record<string, unknown>;
  }) {
    const companyId = this.tenantService.requireCompanyId();
    if (!input.name || !input.phone || !input.roomNo || !input.idCard || !input.houseArea || !input.feeStartDate) {
      throw new BusinessException(ErrorCodes.VALIDATION_FAILED, '姓名/电话/房号/身份证号/房屋面积/物业费起始时间为必填项');
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
    const idCard = input.idCard.trim().toUpperCase();
    const extJson = input.ext ? await this.validateExt(companyId, input.ext) : undefined;
    const residentType = input.residentType ?? ResidentType.OWNER;

    const customer = await this.customerRepo.save(
      this.customerRepo.create({
        companyId,
        projectId: input.projectId,
        personId: person.id,
        residentType,
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
    return this.toView(customer, project.name);
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
        idCardMasked: CryptoService.maskIdCard(this.crypto.decrypt(person.idCardEncrypted)),
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
      vacantEligible: !!activeFiling,
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
        fieldName: 'profileConfirmed',
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
        fieldName: 'profileUnlock',
        oldValue: '',
        newValue: until,
        changedAt: new Date().toISOString(),
      }),
    );
    const project = await this.projectRepo.findOne({ where: { id: customer.projectId } });
    return this.toView(customer, project?.name);
  }

  /** 房屋转售：换绑业主身份，台账/收据仍挂本房源 customerId */
  async resale(
    companyId: number,
    userId: number,
    id: number,
    input: {
      name: string;
      phone: string;
      idCard: string;
      residentType?: ResidentType;
      contractDate?: string;
      remark?: string;
    },
  ) {
    const customer = await this.getOrThrow(companyId, id);
    const fromName = customer.name;
    const fromIdCardMasked = CryptoService.maskIdCard(this.crypto.decrypt(customer.idCardEncrypted));
    const fromPersonId = customer.personId;
    const person = await this.ensurePerson(companyId, {
      name: input.name,
      phone: input.phone,
      idCard: input.idCard,
    });
    const idCard = input.idCard.trim().toUpperCase();
    await this.ownershipRepo.save(
      this.ownershipRepo.create({
        companyId,
        customerId: id,
        fromPersonId,
        toPersonId: person.id,
        fromName,
        fromIdCardMasked,
        toName: person.name,
        toIdCardMasked: CryptoService.maskIdCard(idCard),
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
        fieldName: 'resale',
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

  /** 是否存在有效装修报备（空置优惠资格） */
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
        const idCard = String(v).trim().toUpperCase();
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
      idCard: CryptoService.maskIdCard(this.crypto.decrypt(customer.idCardEncrypted)),
      residentType: customer.residentType,
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

    // 身份证变更时重建/关联自然人身份
    if (trackable['idCard'] || trackable['name'] || trackable['phone']) {
      const plainIdCard = this.crypto.decrypt(customer.idCardEncrypted);
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
      idCard: CryptoService.maskIdCard(this.crypto.decrypt(customer.idCardEncrypted)),
      residentType: customer.residentType,
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

  async transitionStatus(companyId: number, customerId: number, target: HouseStatus): Promise<CustomerEntity> {
    const customer = await this.getOrThrow(companyId, customerId);
    const current = customer.houseStatus as HouseStatus;
    if (current === HouseStatus.UNDELIVERED) {
      throw new BusinessException(ErrorCodes.STATUS_TRANSITION_INVALID, '未交房状态仅能通过交房缴费事务变更为已交房');
    }
    const allowed = HouseStatusTransitionMatrix[current] ?? [];
    if (!allowed.includes(target)) {
      throw new BusinessException(ErrorCodes.STATUS_TRANSITION_INVALID);
    }
    customer.houseStatus = target;
    await this.customerRepo.save(customer);
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
        const idCard = this.crypto.decrypt(c.idCardEncrypted);
        const phone = this.crypto.decrypt(c.phoneEncrypted);
        const person = await this.ensurePerson(c.companyId, { name: c.name, phone, idCard });
        c.personId = person.id;
        if (!c.residentType) c.residentType = ResidentType.OWNER;
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
      idCardMasked: CryptoService.maskIdCard(this.crypto.decrypt(c.idCardEncrypted)),
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
      name: c.name,
      roomNo: c.roomNo,
      phoneMasked: CryptoService.maskPhone(this.crypto.decrypt(c.phoneEncrypted)),
      idCardMasked: CryptoService.maskIdCard(this.crypto.decrypt(c.idCardEncrypted)),
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
