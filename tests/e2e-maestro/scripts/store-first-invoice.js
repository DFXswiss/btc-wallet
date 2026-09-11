if (!maestro.copiedText) throw new Error('No initial BOLT11 invoice found in copied UI text');

output.firstInvoice = maestro.copiedText;
