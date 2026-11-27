import * as Haptics from 'expo-haptics';
import { Platform } from 'react-native';

/** tap: a button press · success: something worked (item scanned) · error: it did not */
export type Feel = 'tap' | 'success' | 'error';

/**
 * A short buzz or click under the finger. It follows the phone's own settings, so a user who turned
 * touch vibration off does not feel it:
 * - Android: goes through the system's haptic call (`performAndroidHapticsAsync`), which obeys the
 *   "Touch vibration" / "Touch feedback" switch. The older impact/notification calls drive the motor
 *   directly and ignore that switch, so they are not used here.
 * - iOS: the system haptics engine, which obeys Settings > Sounds & Haptics > System Haptics.
 * Never throws, and does nothing on the web.
 */
export function haptic(feel: Feel = 'tap'): void {
  try {
    if (Platform.OS === 'android') {
      const type =
        feel === 'success'
          ? Haptics.AndroidHaptics.Confirm
          : feel === 'error'
            ? Haptics.AndroidHaptics.Reject
            : Haptics.AndroidHaptics.Virtual_Key;
      void Haptics.performAndroidHapticsAsync(type).catch(() => undefined);
    } else if (Platform.OS === 'ios') {
      if (feel === 'tap') {
        void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => undefined);
      } else {
        void Haptics.notificationAsync(
          feel === 'success'
            ? Haptics.NotificationFeedbackType.Success
            : Haptics.NotificationFeedbackType.Error,
        ).catch(() => undefined);
      }
    }
  } catch {
    // feedback is a nicety, never a reason for a screen to fail
  }
}
