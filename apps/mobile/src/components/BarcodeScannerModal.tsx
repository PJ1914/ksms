import { CameraView, useCameraPermissions } from 'expo-camera';
import { useEffect, useRef } from 'react';
import { Modal, StyleSheet, Text, View } from 'react-native';
import { Button } from '@/components/ui';
import { colors } from '@/theme/colors';

const BARCODE_TYPES = ['ean13', 'ean8', 'upc_a', 'upc_e', 'code128', 'code39', 'qr'] as const;

/**
 * Reusable single-scan camera modal (expo-camera) for attaching a barcode to a product
 * or looking up a product from the Stock tab.
 */
export function BarcodeScannerModal({
  visible,
  title = 'Scan barcode',
  hint = 'Point the camera at the product barcode.',
  onScanned,
  onClose,
}: {
  visible: boolean;
  title?: string;
  hint?: string;
  onScanned: (code: string) => void;
  onClose: () => void;
}) {
  const [permission, requestPermission] = useCameraPermissions();
  const locked = useRef(false);

  useEffect(() => {
    if (visible) locked.current = false;
  }, [visible]);

  function handleScan(raw: string) {
    const code = raw.trim();
    if (!code || locked.current) return;
    locked.current = true;
    onScanned(code);
  }

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={styles.root}>
        <View style={styles.header}>
          <Text style={styles.title}>{title}</Text>
        </View>

        {!permission ? (
          <View style={styles.center} />
        ) : !permission.granted ? (
          <View style={styles.center}>
            <Text style={styles.note}>Camera permission is needed only to scan barcodes.</Text>
            <Button title="Allow the camera" onPress={() => void requestPermission()} />
            <Button title="Cancel" variant="secondary" onPress={onClose} />
          </View>
        ) : (
          <>
            <CameraView
              style={{ flex: 1 }}
              facing="back"
              barcodeScannerSettings={{ barcodeTypes: [...BARCODE_TYPES] }}
              onBarcodeScanned={({ data }) => handleScan(data)}
            />
            <View style={styles.footer}>
              <Text style={styles.hint}>{hint}</Text>
              <Button title="Cancel" variant="secondary" onPress={onClose} />
            </View>
          </>
        )}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000' },
  header: {
    paddingTop: 52,
    paddingBottom: 14,
    paddingHorizontal: 16,
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  title: { fontSize: 18, fontWeight: '700', color: colors.text },
  center: {
    flex: 1,
    justifyContent: 'center',
    padding: 24,
    backgroundColor: colors.background,
  },
  note: { fontSize: 16, color: colors.text, textAlign: 'center', marginBottom: 16 },
  footer: {
    padding: 20,
    backgroundColor: colors.surface,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
  },
  hint: { fontSize: 14, color: colors.textMuted, textAlign: 'center', marginBottom: 10 },
});
