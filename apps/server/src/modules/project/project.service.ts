import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CommonStatus, ErrorCodes, FeeParameterCode } from '@pms/shared';
import { BusinessException } from '../../common/exceptions/business.exception';
import { CustomerEntity, ProjectEntity } from '../../database/entities/org-entities';
import { ReceiptOrderEntity } from '../../database/entities/charging-entities';
import { FeeParameterService } from '../fee-parameter/fee-parameter.service';

@Injectable()
export class ProjectService {
  constructor(
    @InjectRepository(ProjectEntity) private readonly projectRepo: Repository<ProjectEntity>,
    @InjectRepository(ReceiptOrderEntity) private readonly receiptRepo: Repository<ReceiptOrderEntity>,
    @InjectRepository(CustomerEntity) private readonly customerRepo: Repository<CustomerEntity>,
    private readonly feeParameterService: FeeParameterService,
  ) {}

  /** 项目创建：名称≤50、占地面积>0；同公司重名拒绝（PMS-2001） */
  async create(companyId: number, name: string, landArea: number, address?: string) {
    if (!name || name.length > 50) {
      throw new BusinessException(ErrorCodes.VALIDATION_FAILED, '项目名称必填且不超过 50 字符');
    }
    if (!landArea || landArea <= 0) {
      throw new BusinessException(ErrorCodes.VALIDATION_FAILED, '占地面积必须大于 0');
    }
    const exists = await this.projectRepo.findOne({ where: { companyId, name } });
    if (exists) {
      throw new BusinessException(ErrorCodes.PROJECT_NAME_DUP);
    }
    return this.toView(
      await this.projectRepo.save(
        this.projectRepo.create({
          companyId,
          name,
          landArea: Math.round(landArea * 100),
          address: address?.trim() || undefined,
          status: CommonStatus.ACTIVE,
        }),
      ),
    );
  }

  async list(companyId: number, page = 1, pageSize = 20) {
    const [list, total] = await this.projectRepo.findAndCount({
      where: { companyId },
      order: { createdAt: 'DESC' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    });
    const withStats = await Promise.all(
      list.map(async (p) => {
        const customerCount = await this.customerRepo
          .createQueryBuilder('c')
          .where('c.companyId = :companyId', { companyId })
          .andWhere('c.projectId = :projectId', { projectId: p.id })
          .andWhere('c.deletedAt IS NULL')
          .getCount();
        const feeItems = await this.feeParameterService.currentWithSource(companyId, p.id);
        const unit = feeItems.find((i) => i.itemCode === FeeParameterCode.PROPERTY_FEE_UNIT_PRICE);
        const unitL1 = feeItems.find(
          (i) => i.itemCode === FeeParameterCode.PROPERTY_FEE_UNIT_PRICE_COMMERCIAL,
        );
        const unitL2 = feeItems.find(
          (i) => i.itemCode === FeeParameterCode.PROPERTY_FEE_UNIT_PRICE_COMMERCIAL_L2,
        );
        return {
          ...this.toView(p),
          customerCount,
          propertyFeeUnitPrice: unit?.value ?? 0,
          propertyFeeSource: unit?.source ?? 'company',
          propertyFeeUnitPriceCommercial: unitL1?.value ?? 200,
          propertyFeeCommercialSource: unitL1?.source ?? 'company',
          propertyFeeUnitPriceCommercialL2: unitL2?.value ?? 70,
          propertyFeeCommercialL2Source: unitL2?.source ?? 'company',
        };
      }),
    );
    return { list: withStats, total, page, pageSize };
  }

  /** 项目费用参数（含来源） */
  async feeParameters(companyId: number, projectId: number) {
    await this.detail(companyId, projectId);
    return this.feeParameterService.currentWithSource(companyId, projectId);
  }

  /** 调整项目级费用参数（新增版本，仅影响新单） */
  async updateFeeParameter(
    companyId: number,
    userId: number,
    projectId: number,
    itemCode: FeeParameterCode,
    value: number,
  ) {
    await this.detail(companyId, projectId);
    return this.feeParameterService.update(companyId, userId, { itemCode, projectId, value });
  }

  async detail(companyId: number, id: number) {
    const project = await this.projectRepo.findOne({ where: { id, companyId } });
    if (!project) throw new BusinessException(ErrorCodes.VALIDATION_FAILED, '项目不存在');
    return this.toView(project);
  }

  /** 项目修改（历史收款单快照不回溯） */
  async update(companyId: number, id: number, patch: { name?: string; landArea?: number; address?: string; status?: string }) {
    const project = await this.projectRepo.findOne({ where: { id, companyId } });
    if (!project) throw new BusinessException(ErrorCodes.VALIDATION_FAILED, '项目不存在');
    if (patch.name) {
      if (patch.name.length > 50) {
        throw new BusinessException(ErrorCodes.VALIDATION_FAILED, '项目名称不超过 50 字符');
      }
      if (patch.name !== project.name) {
        const exists = await this.projectRepo.findOne({ where: { companyId, name: patch.name } });
        if (exists) throw new BusinessException(ErrorCodes.PROJECT_NAME_DUP);
        project.name = patch.name;
      }
    }
    if (patch.landArea !== undefined) {
      if (patch.landArea <= 0) throw new BusinessException(ErrorCodes.VALIDATION_FAILED, '占地面积必须大于 0');
      project.landArea = Math.round(patch.landArea * 100);
    }
    if (patch.address !== undefined) {
      project.address = patch.address.trim() || undefined;
    }
    if (patch.status && Object.values(CommonStatus).includes(patch.status as CommonStatus)) {
      project.status = patch.status;
    }
    const saved = await this.projectRepo.save(project);
    const hasReceipts = await this.receiptRepo.findOne({ where: { companyId, projectId: id } });
    return { ...this.toView(saved), hasReceipts: !!hasReceipts };
  }

  async findAllInScope(companyId: number): Promise<ProjectEntity[]> {
    return this.projectRepo.find({ where: { companyId, status: CommonStatus.ACTIVE }, order: { name: 'ASC' } });
  }

  /** 下拉选项（轻量，供全局项目切换器） */
  async options(companyId: number) {
    const list = await this.findAllInScope(companyId);
    return list.map((p) => ({
      id: p.id,
      name: p.name,
      address: p.address ?? '',
      landArea: p.landArea / 100,
    }));
  }

  private toView(p: ProjectEntity) {
    return {
      id: p.id,
      companyId: p.companyId,
      name: p.name,
      address: p.address ?? '',
      landArea: p.landArea / 100,
      status: p.status,
      createdAt: p.createdAt,
      updatedAt: p.updatedAt,
    };
  }
}
