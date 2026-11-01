import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import { buildObjectKey, DESIGN_FILE_POLICY, StorageService, validateFile } from '@cfe/integration-sdk';
import { designCreateSchema, designListQuery, designUpdateSchema, z } from '@cfe/validation';
import { Prisma } from '@cfe/database';
import { bucketForAssetKind } from '../assets/assets.service';
import { AuditService } from '../common/audit.service';
import { AuthUser } from '../common/decorators';
import { found } from '../common/owned';
import { orderBy, pageArgs, paginated } from '../common/pagination';
import { PrismaService } from '../common/prisma.service';

export interface UploadedFile {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

@Injectable()
export class DesignsService {
  constructor(private readonly prisma: PrismaService, private readonly storage: StorageService, private readonly audit: AuditService) {}

  async list(orgId: string, q: z.infer<typeof designListQuery>) {
    const where: Prisma.DesignWhereInput = {
      organizationId: orgId,
      ...(q.status ? { status: q.status } : {}),
      ...(q.collectionId ? { collections: { some: { collectionId: q.collectionId } } } : {}),
      ...(q.q ? { OR: [{ title: { contains: q.q, mode: 'insensitive' } }, { tags: { has: q.q.toLowerCase() } }] } : {}),
    };
    const [items, total] = await Promise.all([
      this.prisma.design.findMany({
        where,
        orderBy: orderBy(q, ['title', 'createdAt', 'updatedAt', 'status'] as const, 'updatedAt'),
        ...pageArgs(q),
        include: {
          collections: { include: { collection: { select: { id: true, name: true } } } },
          _count: { select: { products: true, listings: true, versions: true } },
        },
      }),
      this.prisma.design.count({ where }),
    ]);
    return paginated(items, total, q);
  }

  async get(orgId: string, id: string) {
    return found(
      await this.prisma.design.findFirst({
        where: { id, organizationId: orgId },
        include: {
          versions: { orderBy: { versionNumber: 'desc' }, include: { assets: { orderBy: { createdAt: 'desc' } } } },
          collections: { include: { collection: true } },
          products: { select: { id: true, title: true, type: true, status: true } },
          listings: { select: { id: true, channel: true, marketplace: true, externalId: true, status: true } },
        },
      }),
      'Design',
    );
  }

  private async assertCollections(orgId: string, ids: string[]) {
    if (ids.length === 0) return;
    const count = await this.prisma.collection.count({ where: { id: { in: ids }, organizationId: orgId } });
    if (count !== ids.length) throw new BadRequestException('One or more collections do not exist');
  }

  async create(user: AuthUser, body: z.infer<typeof designCreateSchema>) {
    await this.assertCollections(user.organizationId, body.collectionIds);
    const design = await this.prisma.design.create({
      data: {
        organizationId: user.organizationId,
        title: body.title,
        description: body.description,
        category: body.category,
        tags: body.tags.map((t) => t.toLowerCase()),
        versions: { create: { versionNumber: 1, notes: 'Initial version' } },
        collections: { create: body.collectionIds.map((collectionId) => ({ collectionId })) },
      },
    });
    await this.audit.log(user, 'design.created', 'Design', design.id, { title: design.title });
    return design;
  }

  /** Approval is an IP/copyright judgment and requires the designs:approve permission. */
  async update(user: AuthUser, id: string, body: z.infer<typeof designUpdateSchema>) {
    const existing = found(await this.prisma.design.findFirst({ where: { id, organizationId: user.organizationId } }), 'Design');
    const approving = body.status === 'APPROVED' && existing.status !== 'APPROVED';
    if (approving && !user.permissions.includes('designs:approve')) throw new ForbiddenException('Missing permission: designs:approve');
    if (body.collectionIds) await this.assertCollections(user.organizationId, body.collectionIds);

    const { collectionIds, tags, ...fields } = body;
    const design = await this.prisma.$transaction(async (tx) => {
      if (collectionIds) {
        await tx.designCollection.deleteMany({ where: { designId: id } });
        await tx.designCollection.createMany({ data: collectionIds.map((collectionId) => ({ designId: id, collectionId })) });
      }
      return tx.design.update({
        where: { id },
        data: {
          ...fields,
          ...(tags ? { tags: tags.map((t) => t.toLowerCase()) } : {}),
          ...(approving ? { approvedAt: new Date(), approvedById: user.id } : {}),
          ...(body.status && body.status !== 'APPROVED' ? { approvedAt: null, approvedById: null } : {}),
        },
      });
    });
    await this.audit.log(user, approving ? 'design.approved' : 'design.updated', 'Design', id, body);
    if (approving) {
      await this.prisma.automationRun.create({
        data: {
          organizationId: user.organizationId, trigger: 'design.approved', action: 'listing.allow', level: 'AUTOMATIC',
          status: 'SUCCEEDED', subjectType: 'Design', subjectId: id, startedAt: new Date(), finishedAt: new Date(),
          output: { message: 'Design approved; listings may now reference it' },
        },
      });
    }
    return design;
  }

  async uploadAsset(user: AuthUser, id: string, file: UploadedFile | undefined, opts: { kind: 'ORIGINAL' | 'PRINT_FILE' | 'MOCKUP' | 'PREVIEW'; newVersion: boolean; notes?: string }) {
    if (!file) throw new BadRequestException('A file is required (multipart field "file")');
    try {
      validateFile(file, DESIGN_FILE_POLICY);
    } catch (err) {
      throw new BadRequestException((err as Error).message);
    }
    const design = found(
      await this.prisma.design.findFirst({ where: { id, organizationId: user.organizationId }, include: { versions: { orderBy: { versionNumber: 'desc' }, take: 1 } } }),
      'Design',
    );
    const latest = design.versions[0];
    const bucket = bucketForAssetKind(opts.kind);
    const stored = await this.storage.putObject(bucket, buildObjectKey(user.organizationId, 'designs', id, file.originalname), file.buffer, file.mimetype);

    const asset = await this.prisma.$transaction(async (tx) => {
      const version = opts.newVersion
        ? await tx.designVersion.create({ data: { designId: id, versionNumber: latest.versionNumber + 1, notes: opts.notes } })
        : latest;
      return tx.designAsset.create({
        data: {
          organizationId: user.organizationId,
          designVersionId: version.id,
          kind: opts.kind,
          bucket: stored.bucket,
          objectKey: stored.objectKey,
          fileName: file.originalname,
          contentType: file.mimetype,
          sizeBytes: stored.sizeBytes,
          checksumSha256: stored.checksumSha256,
        },
      });
    });
    await this.prisma.automationRun.create({
      data: {
        organizationId: user.organizationId, trigger: 'design.asset_uploaded', action: 'design.create_version', level: 'AUTOMATIC',
        status: 'SUCCEEDED', subjectType: 'DesignAsset', subjectId: asset.id, startedAt: new Date(), finishedAt: new Date(),
        output: { designId: id, kind: opts.kind, checksumSha256: asset.checksumSha256 },
      },
    });
    await this.audit.log(user, 'design.asset_uploaded', 'Design', id, { assetId: asset.id, kind: opts.kind });
    return asset;
  }
}
