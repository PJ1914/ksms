import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { downloadHeaders } from '@/auth/session';
import { API_URL } from '@/config';

/**
 * Shares an invoice as a PDF. The PDF is made by the server from the saved invoice, downloaded to the phone's
 * cache just long enough to hand to the share sheet, then deleted. Nothing is kept in the app.
 * Returns false when sharing files is not possible on this device.
 */
export async function shareInvoicePdf(invoiceId: string, invoiceNumber: string): Promise<boolean> {
  if (!(await Sharing.isAvailableAsync())) return false;
  const safe = invoiceNumber.replace(/[^A-Za-z0-9_-]/g, '-');
  const target = new File(Paths.cache, `Invoice-${safe}.pdf`);
  try {
    const file = await File.downloadFileAsync(`${API_URL}/invoices/${invoiceId}/pdf`, target, {
      headers: await downloadHeaders(),
      idempotent: true,
    });
    await Sharing.shareAsync(file.uri, {
      mimeType: 'application/pdf',
      dialogTitle: `Invoice ${invoiceNumber}`,
      UTI: 'com.adobe.pdf',
    });
    return true;
  } finally {
    try {
      if (target.exists) target.delete();
    } catch {
      // the cache is cleared by the system anyway
    }
  }
}
