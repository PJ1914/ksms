import { CameraView, useCameraPermissions } from 'expo-camera';
import { router, Stack } from 'expo-router';
import { useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { getData } from '@/api/client';
import type { ProductDetail } from '@/api/types';
import { useCart } from '@/cart/CartProvider';
import { Button, ErrorText } from '@/components/ui';
import { colors } from '@/theme/colors';
import { friendlyError } from '@/utils/errors';

interface Lookup {
  barcode: { unitId: string | null };
  product: ProductDetail;
}

/** Scan a barcode: the item goes straight onto the bill (1 of the unit the barcode stands for). */
export default function ScanScreen() {
  const [permission, requestPermission] = useCameraPermissions();
  const { add } = useCart();
  const busy = useRef(false);
  const lastCode = useRef<{ code: string; at: number } | null>(null);
  const [message, setMessage] = useState<{ text: string; ok: boolean } | null>(null);
  const [count, setCount] = useState(0);

  async function onScanned(code: string) {
    const now = Date.now();
    // the camera reports the same code many times a second: handle each one once, and not again for 2 seconds
    if (
      busy.current ||
      (lastCode.current && lastCode.current.code === code && now - lastCode.current.at < 2000)
    )
      return;
    busy.current = true;
    lastCode.current = { code, at: now };
    try {
      const r = await getData<Lookup>(`/products/by-barcode/${encodeURIComponent(code)}`);
      const sale = r.product.conversions.filter((c) => c.isSaleUnit);
      const unit =
        sale.find((c) => c.unitId === r.barcode.unitId) ?? sale.find((c) => c.isBase) ?? sale[0];
      if (!unit) throw new Error('no sale unit');
      add({
        productId: r.product.id,
        name: r.product.name,
        unitId: unit.unitId,
        unitCode: unit.unitCode,
        quantity: '1',
      });
      setCount((c) => c + 1);
      setMessage({ ok: true, text: `Added ${r.product.name} (1 ${unit.unitCode})` });
    } catch (e) {
      setMessage({
        ok: false,
        text:
          e instanceof Error && e.message === 'no sale unit'
            ? 'This product cannot be sold in a unit.'
            : friendlyError(e),
      });
    } finally {
      setTimeout(() => (busy.current = false), 800);
    }
  }

  if (!permission) return <View style={styles.center} />;
  if (!permission.granted) {
    return (
      <View style={styles.center}>
        <Text style={styles.note}>The camera is needed only to scan barcodes.</Text>
        <Button title="Allow the camera" onPress={() => void requestPermission()} />
        <Button title="Back" variant="secondary" onPress={() => router.back()} />
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: '#000' }}>
      <Stack.Screen options={{ title: 'Scan barcodes' }} />
      <CameraView
        style={{ flex: 1 }}
        facing="back"
        barcodeScannerSettings={{
          barcodeTypes: ['ean13', 'ean8', 'upc_a', 'upc_e', 'code128', 'code39', 'qr'],
        }}
        onBarcodeScanned={({ data }) => void onScanned(data)}
      />
      <View style={styles.panel}>
        {message ? (
          message.ok ? (
            <Text style={[styles.note, { color: colors.success }]}>{message.text}</Text>
          ) : (
            <ErrorText message={message.text} />
          )
        ) : (
          <Text style={styles.note}>Point the camera at a barcode.</Text>
        )}
        <Button title={count ? `Done (${count} added)` : 'Done'} onPress={() => router.back()} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    backgroundColor: colors.background,
  },
  panel: { padding: 16, backgroundColor: colors.surface },
  note: { fontSize: 16, color: colors.text, marginBottom: 12, textAlign: 'center' },
});
