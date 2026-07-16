#!/usr/bin/env node
/**
 * Demo: stamp a test CFDI de Ingreso against the PAC sandbox.
 *
 * Facturama (default):
 *   FACTURAMA_USER=... FACTURAMA_PASSWORD=... FACTURAMA_ENV=sandbox \
 *     node scripts/timbra-demo.js
 *
 * Facturapi:
 *   PAC_PROVIDER=facturapi FACTURAPI_KEY=sk_test_... node scripts/timbra-demo.js
 *
 * Uses SAT test receiver data so it stamps without a real customer, and prints
 * the SAT UUID (Folio Fiscal) + PDF/XML links. No database access required.
 */

require('dotenv').config();
const pac = require('../src/services/pacService');

async function main() {
  const provider = process.env.PAC_PROVIDER || 'facturama';
  if (provider === 'facturama' && !process.env.FACTURAMA_USER) {
    console.error('Set FACTURAMA_USER / FACTURAMA_PASSWORD (sandbox credentials).');
    process.exit(1);
  }

  console.log(`Timbrando CFDI de prueba (proveedor: ${provider}, sandbox)...\n`);

  const result = await pac.stampIngreso({
    provider,
    // Issuer = the account's fiscal profile (sandbox).
    issuer: {
      rfc: 'SCD2507076C4',
      name: '642 STUDIO',
      fiscalRegime: '626',
    },
    // SAT/PAC sandbox test receiver.
    receiver: {
      rfc: 'URE180429TM6',
      name: 'UNIVERSIDAD ROBOTICA ESPAÑOLA',
      fiscalRegime: '601',
      use: 'G03',
      zip: '65000',
    },
    expeditionPlace: '85800',
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
