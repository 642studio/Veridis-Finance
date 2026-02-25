const { z } = require('zod');

const { resolveOrganizationId } = require('../middleware/auth');
const {
  createImportPreview,
  confirmImport,
} = require('../services/bankStatementImportService');
const {
  parseBankStatementPdf,
} = require('../services/bankStatements/pdfStatementParserService');

const uploadFormSchema = z.object({
  bank: z.string().min(2).max(80),
});

const confirmParamsSchema = z.object({
  importId: z.string().uuid(),
});

const confirmBodySchema = z.object({
  transactions: z
    .array(
      z.object({
        transaction_date: z.string().optional(),
        type: z.enum(['income', 'expense']).optional(),
        amount: z.coerce.number().positive().optional(),
        concept: z.string().min(1).max(120).optional(),
        category: z.string().min(1).max(120).optional(),
        category_id: z.string().uuid().optional().nullable(),
        subcategory_id: z.string().uuid().optional().nullable(),
        member_id: z.string().uuid().optional().nullable(),
        client_id: z.string().uuid().optional().nullable(),
        vendor_id: z.string().uuid().optional().nullable(),
        raw_description: z.string().min(1).max(500).optional(),
        folio: z.string().max(120).optional(),
        bank: z.string().max(80).optional(),
        member_name: z.string().max(120).optional().nullable(),
        client_name: z.string().max(120).optional().nullable(),
        vendor_name: z.string().max(120).optional().nullable(),
        confidence_score: z.coerce.number().min(0).max(2).optional(),
        match_confidence: z.coerce.number().min(0).max(1).optional().nullable(),
        match_method: z.enum(['rule', 'fuzzy', 'manual']).optional().nullable(),
      })
    )
    .optional(),
});

function badRequest(message) {
  const error = new Error(message);
  error.statusCode = 400;
  return error;
}

async function uploadBankStatement(request, reply) {
  if (!request.isMultipart()) {
    throw badRequest('Content-Type must be multipart/form-data');
  }

  let bankRaw;
  let pdfBuffer;
  let pdfFileName = '';
  let pdfMimeType = '';

  for await (const part of request.parts()) {
    if (part.type === 'file') {
      if (pdfBuffer) {
        throw badRequest('Only one PDF file is allowed');
      }

      pdfFileName = part.filename || '';
      pdfMimeType = part.mimetype || '';
      pdfBuffer = await part.toBuffer();
      continue;
    }

    if (part.fieldname === 'bank') {
      bankRaw = part.value;
    }
  }

  if (!pdfBuffer) {
    throw badRequest('PDF file is required');
  }

  const isPdfByName = pdfFileName.toLowerCase().endsWith('.pdf');
  const isPdfMime = pdfMimeType === 'application/pdf';

  if (!isPdfByName && !isPdfMime) {
    throw badRequest('Uploaded file must be a PDF');
  }

  const formPayload = uploadFormSchema.parse({
    bank: bankRaw,
  });

  const organizationId = resolveOrganizationId(request);
  const parsed = await parseBankStatementPdf({
    pdfBuffer,
    bank: formPayload.bank,
  });

  const importRecord = await createImportPreview({
    organization_id: organizationId,
    bank: parsed.bank,
    account_number: parsed.account_number,
    period_start: parsed.period_start,
    period_end: parsed.period_end,
    file_name: pdfFileName || null,
    file_size_bytes: pdfBuffer.length,
    parsed_transactions: parsed.transactions,
    created_by_user_id: request.user?.user_id || null,
  });

  request.log.info(
    {
      source: 'bank_statement_upload',
      organization_id: organizationId,
      import_id: importRecord.id,
      bank: importRecord.bank,
      preview_count: importRecord.preview_count,
    },
    'Bank statement parsed and preview stored'
  );

  reply.status(201).send({
    data: {
      import_id: importRecord.id,
      bank: importRecord.bank,
      account_number: importRecord.account_number,
      period_start: importRecord.period_start,
      period_end: importRecord.period_end,
      preview_count: importRecord.preview_count,
      transactions_preview: importRecord.parsed_transactions,
      status: importRecord.status,
    },
  });
}

async function confirmBankStatementImport(request, reply) {
  const params = confirmParamsSchema.parse(request.params);
  const body = confirmBodySchema.parse(request.body || {});
  const organizationId = resolveOrganizationId(request);

  const result = await confirmImport({
    importId: params.importId,
    organizationId,
    transactionOverrides: body.transactions,
  });

  request.log.info(
    {
      source: 'bank_statement_confirm',
      organization_id: organizationId,
      import_id: params.importId,
      inserted_count: result.inserted_count,
      skipped_duplicates: result.skipped_duplicates,
      skipped_invalid: result.skipped_invalid,
    },
    'Bank statement import confirmed'
  );

  reply.send({ data: result });
}

module.exports = {
  uploadBankStatement,
  confirmBankStatementImport,
};
