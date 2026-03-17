import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { authMiddleware } from '../middleware/auth.middleware.js';
import { orgMiddleware } from '../middleware/org.middleware.js';
import { validate } from '../utils/validators.js';
import { success } from '../utils/response.js';
import { AppError } from '../utils/errors.js';
import { env } from '../config/env.js';

// ── Schemas ────────────────────────────────────────────────────────────────

const presignSchema = z.object({
  filename: z.string().min(1).max(255),
  content_type: z.string().min(1).max(100),
  record_type: z.enum(['invoice', 'estimate', 'job', 'customer', 'inventory']),
  record_id: z.string().uuid(),
});

const confirmSchema = z.object({
  key: z.string().min(1).max(1000),
  record_type: z.enum(['invoice', 'estimate', 'job', 'customer', 'inventory']),
  record_id: z.string().uuid(),
});

// ── Shared preHandlers ─────────────────────────────────────────────────────

const auth = [authMiddleware, orgMiddleware];

// ── Routes ─────────────────────────────────────────────────────────────────

export default async function uploadRoutes(app: FastifyInstance): Promise<void> {
  // POST /presign — Get a presigned S3 URL for uploading
  app.post('/presign', { preHandler: auth }, async (request: FastifyRequest, reply: FastifyReply) => {
    const body = validate(presignSchema, request.body);

    try {
      // Generate a unique key for the file
      const timestamp = Date.now();
      const sanitizedFilename = body.filename.replace(/[^a-zA-Z0-9._-]/g, '_');
      const key = `${request.orgId}/${body.record_type}/${body.record_id}/${timestamp}_${sanitizedFilename}`;

      // TODO: Generate real presigned URL using S3 SDK
      // For now, return a stub response
      const presignedUrl = `https://${env.S3_BUCKET ?? 'crewshift-uploads'}.s3.${env.S3_REGION ?? 'us-east-1'}.amazonaws.com/${key}`;

      return reply.send(
        success({
          upload_url: presignedUrl,
          key,
          expires_in: 3600, // 1 hour
          method: 'PUT',
          headers: {
            'Content-Type': body.content_type,
          },
        }),
      );
    } catch (err) {
      if (err instanceof AppError) throw err;
      request.log.error({ err }, 'Failed to generate presigned URL');
      throw new AppError(500, 'PRESIGN_FAILED', 'Failed to generate upload URL');
    }
  });

  // POST /confirm — Confirm file upload and associate with record
  app.post('/confirm', { preHandler: auth }, async (request: FastifyRequest, reply: FastifyReply) => {
    const body = validate(confirmSchema, request.body);

    try {
      // TODO: Verify the file exists in S3
      // TODO: Store file metadata in a files/attachments table

      // Stub: Just return success
      return reply.send(
        success({
          key: body.key,
          record_type: body.record_type,
          record_id: body.record_id,
          confirmed: true,
          url: `https://${env.S3_BUCKET ?? 'crewshift-uploads'}.s3.${env.S3_REGION ?? 'us-east-1'}.amazonaws.com/${body.key}`,
        }),
      );
    } catch (err) {
      if (err instanceof AppError) throw err;
      request.log.error({ err }, 'Failed to confirm upload');
      throw new AppError(500, 'UPLOAD_CONFIRM_FAILED', 'Failed to confirm upload');
    }
  });
}
