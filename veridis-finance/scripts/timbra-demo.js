#!/usr/bin/env node
/**
 * Demo: stamp a test CFDI de Ingreso against the Facturama sandbox.
 *
 *   FACTURAMA_USER=... FACTURAMA_PASSWORD=... FACTURAMA_ENV=sandbox \
 *     node scripts/timbra-demo.js
 *
 * API Web modality: the issuer (emisor) is taken from the account's Tax Profile
 * in Facturama, so we do NOT send an Issuer object. The profile's razón social
 * must match the CSD exactly (UPPERCASE, no régimen de capital) or timbrado
 * fails with "el nombre del emisor debe pertenecer al nombre asociado al RFC".
 *
 * Receiver uses the SAT sandbox test RFC EKU9003173C9 with its registered CP.
 * No database access required — this proves the timbrado path end to end.
 */

require('dotenv').config();
const pac = require('../src/services/pacService');

async function main() {
  const provider = process.env.PAC_PROVIDER || 'facturama';
  if (provider === 'facturama' && !process.env.FACTURAMA_USER) {
    console.error('Set FACTURAMA_USER / FACTURAMA_PASSWORD (sandbox credentials).');
    process.exit(1);
  }

  console.log(`Timbrando CFDI de prueba (proveedor: ${provider})...\n`);

  const result = await pac.stampIngreso({
    provider,
    // SAT sandbox test receiver (RFC + CP must match SAT's padrón de pruebas).
    receiver: {
      rfc: 'EKU9003173C9',
      name: 'ESCUELA KEMPER URGATE',
      fiscalRegime: '601',
      use: 'G03',
      zip: '42501',
    },
    expeditionPlace: '85800', // issuer CP (must be a Lugar de Expedición in the profile)
    paymentForm: '03', // Transferencia
    paymentMethod: 'PUE',
    items: [
      {
        description: 'Servicio de consultoría Veridis',
        productKey: '84111506',
        unitKey: 'E48',
        quantity: 1,
        unitPrice: 1000,
        ivaRate: 0.16,
      },
    ],
  });

  console.log('✅ CFDI timbrado');
  console.log('   UUID (Folio Fiscal):', result.uuid);
  console.log('   Folio:              ', result.folio);
  console.log('   Total:              ', result.total, 'MXN');
  console.log('   Estatus:            ', result.status);
  console.log('   PDF:                ', result.pdfUrl);
  console.log('   XML:                ', result.xmlUrl);
}

main().catch((err) => {
  console.error('❌ Error al timbrar:', err.message);
  if (err.response?.data) console.error(JSON.stringify(err.response.data, null, 2));
  process.exit(1);
});
