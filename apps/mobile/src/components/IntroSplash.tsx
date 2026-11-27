import * as SplashScreen from 'expo-splash-screen';
import { useEffect, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  Animated,
  Easing,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { MAX_FONT_SCALE } from '@/components/ui';
import { brand } from '@/theme/art';
import { colors } from '@/theme/colors';

// Keep the phone's own splash (the icon on cream) up until this intro is drawn, so there is no flash.
void SplashScreen.preventAutoHideAsync().catch(() => undefined);

const { awning, body, rupee } = brand;

/** Same width as the native splash image (app.json imageWidth), so the hand-over is seamless. */
const ICON_W = 160;
const ICON_H = Math.round((ICON_W * 474) / 512);
const MOTION_MS = 2700; // the build-up plus a short pause to take it in; the app keeps loading underneath

/**
 * The opening animation: the shop icon comes alive (the awning lifts and settles, the ₹ pops), then
 * "Yapaaram" and the tagline rise in, and the whole thing fades into the app. It shows once per
 * launch, never adds more than about a second, waits softly if the app is still loading, can be
 * skipped with a tap, and stays still when the phone's "remove animations" setting is on.
 */
export function IntroSplash({ ready }: { ready: boolean }) {
  const [gone, setGone] = useState(false);
  const [motionDone, setMotionDone] = useState(false);
  const leaving = useRef(false);

  const awningY = useRef(new Animated.Value(0)).current;
  const rupeeScale = useRef(new Animated.Value(1)).current;
  const groupY = useRef(new Animated.Value(0)).current;
  const groupScale = useRef(new Animated.Value(1)).current;
  const nameIn = useRef(new Animated.Value(0)).current;
  const tagIn = useRef(new Animated.Value(0)).current;
  const fade = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const still = await AccessibilityInfo.isReduceMotionEnabled().catch(() => false);
      if (cancelled) return;
      if (still) {
        // no movement: show the finished picture briefly
        groupY.setValue(-40);
        groupScale.setValue(0.82);
        nameIn.setValue(1);
        tagIn.setValue(1);
        setTimeout(() => !cancelled && setMotionDone(true), 900);
        return;
      }
      const drive = { useNativeDriver: true };
      Animated.parallel([
        // the shop "opens": awning lifts a little and settles with a soft bounce
        Animated.sequence([
          Animated.timing(awningY, {
            toValue: -18,
            duration: 380,
            easing: Easing.out(Easing.quad),
            ...drive,
          }),
          Animated.spring(awningY, { toValue: 0, friction: 5, tension: 60, ...drive }),
        ]),
        // the ₹ pops
        Animated.sequence([
          Animated.delay(650),
          Animated.timing(rupeeScale, {
            toValue: 1.2,
            duration: 300,
            easing: Easing.out(Easing.quad),
            ...drive,
          }),
          Animated.spring(rupeeScale, { toValue: 1, friction: 4, tension: 70, ...drive }),
        ]),
        // the icon makes room for the name
        Animated.sequence([
          Animated.delay(1150),
          Animated.parallel([
            Animated.timing(groupY, {
              toValue: -40,
              duration: 650,
              easing: Easing.out(Easing.cubic),
              ...drive,
            }),
            Animated.timing(groupScale, {
              toValue: 0.82,
              duration: 650,
              easing: Easing.out(Easing.cubic),
              ...drive,
            }),
          ]),
        ]),
        Animated.sequence([
          Animated.delay(1400),
          Animated.timing(nameIn, {
            toValue: 1,
            duration: 600,
            easing: Easing.out(Easing.cubic),
            ...drive,
          }),
        ]),
        Animated.sequence([
          Animated.delay(1850),
          Animated.timing(tagIn, { toValue: 1, duration: 500, ...drive }),
        ]),
      ]).start();
      setTimeout(() => !cancelled && setMotionDone(true), MOTION_MS);
    })();
    return () => {
      cancelled = true;
    };
  }, [awningY, rupeeScale, groupY, groupScale, nameIn, tagIn]);

  function leave() {
    if (leaving.current) return;
    leaving.current = true;
    Animated.timing(fade, {
      toValue: 0,
      duration: 450,
      easing: Easing.in(Easing.quad),
      useNativeDriver: true,
    }).start(() => setGone(true));
  }

  // leave once the motion has played AND the app is ready underneath
  useEffect(() => {
    if (motionDone && ready) leave();
  });

  if (gone) return null;

  return (
    <Animated.View
      style={[StyleSheet.absoluteFill, styles.wrap, { opacity: fade }]}
      onLayout={() => void SplashScreen.hideAsync().catch(() => undefined)}
      accessibilityLabel="Yapaaram is opening"
    >
      <Pressable
        style={StyleSheet.absoluteFill}
        accessibilityRole="button"
        accessibilityLabel="Skip"
        onPress={() => (ready ? leave() : setMotionDone(true))}
      />
      <View pointerEvents="none" style={styles.center}>
        <Animated.View
          style={{
            width: ICON_W,
            height: ICON_H,
            transform: [{ translateY: groupY }, { scale: groupScale }],
          }}
        >
          <Animated.Image source={body} style={styles.layer} />
          <Animated.Image
            source={rupee}
            style={[styles.layer, { transform: [{ scale: rupeeScale }] }]}
          />
          <Animated.Image
            source={awning}
            style={[styles.layer, { transform: [{ translateY: awningY }] }]}
          />
        </Animated.View>
        <Animated.View
          style={{
            position: 'absolute',
            top: '50%',
            marginTop: ICON_H / 2 - 18,
            alignItems: 'center',
            opacity: nameIn,
            transform: [
              { translateY: nameIn.interpolate({ inputRange: [0, 1], outputRange: [16, 0] }) },
            ],
          }}
        >
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={styles.name}>
            Yapaaram
          </Text>
          <Animated.Text
            maxFontSizeMultiplier={MAX_FONT_SCALE}
            style={[styles.tag, { opacity: tagIn }]}
          >
            Your shop, in your pocket
          </Animated.Text>
        </Animated.View>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: { backgroundColor: colors.background, zIndex: 1000, elevation: 1000 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  layer: { position: 'absolute', width: ICON_W, height: ICON_H, resizeMode: 'contain' },
  name: {
    fontSize: 34,
    fontWeight: '800',
    color: colors.primaryDark,
    letterSpacing: 0.5,
  },
  tag: { fontSize: 15, color: colors.textMuted, marginTop: 4 },
});
