const { testSMS } = require('../services/sendSMS');

async function runSMSTest() {
  console.log('🧪 Test d\'envoi SMS avec Twilio');
  console.log('=====================================');
  
  // Numéro de test camerounais
  const numeroTest = '+237655000000';
  
  try {
    console.log(`📱 Envoi du SMS de test vers ${numeroTest}...`);
    
    const result = await testSMS(numeroTest);
    
    if (result.success) {
      console.log('✅ SMS envoyé avec succès !');
      console.log(`📋 SID: ${result.sid}`);
      console.log(`📞 Destinataire: ${result.to}`);
      console.log(`💬 Message: ${result.message}`);
    } else {
      console.log('❌ Échec de l\'envoi du SMS');
      console.log(`🚫 Erreur: ${result.error}`);
    }
    
  } catch (error) {
    console.error('💥 Erreur lors du test SMS:', error.message);
  }
  
  console.log('=====================================');
  console.log('🏁 Test terminé');
}

// Exécuter le test si le script est appelé directement
if (require.main === module) {
  runSMSTest();
}

module.exports = { runSMSTest };