#!/usr/bin/env node
/**
 * Demo: stamp a test CFDI de Ingreso against the Facturapi sandbox.
 *
 *   FACTURAPI_KEY=sk_test_xxx node scripts/timbra-demo.js
 *
 * Uses Facturapi's well-known sandbox test RFCs so it stamps without needing a
 * real receiver. Prints the SAT UUID (Folio Fiscal) and the PDF/XML links.
 * No database access required — this proves the timbrado path end to end.
 */

require('dotenv').config();
const pac = require('../src/services/pacService');

async function main() {
  if (!process.env.FACTURAPI_KEY) {
    console.error('Set FACTURAPI_KEY (use your sk_test_... sandbox key).');
    process.exit(1);
  }

  console.log('Timbrando CFDI de prueba en el sandbox de Facturapi...\n');

  const result = await pac.stampIngreso({
    receiver: {
      // Facturapi sandbox test receiver (matches SAT test data).
      rfc: 'URE180429TM6',
      name: 'UNIVERSIDAD ROBOTICA ESPAÑOLA',
      fiscalRegime: '601',
      use: 'G03',
      zip: '65000',
    },
    paymentForm: '03', // Transferencia
    paymentMethod: 'PUE',
    items: [
      {
        description: 'Servicio de consultoría Veridis',
        productKey: '84111506', // Servicios de facturación
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
