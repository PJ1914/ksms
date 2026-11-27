/** On the web the invoice is printed from the page (Print bill), so there is no PDF share. */
export async function shareInvoicePdf(): Promise<boolean> {
  return false;
}
