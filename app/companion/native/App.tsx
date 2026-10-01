import React, { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import {
  BackHandler, KeyboardAvoidingView, Platform, Pressable, ScrollView, StatusBar,
  Text, View, useWindowDimensions,
} from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import type { CompanionScreen, CompanionScreenController } from '../shared/view-contracts';
import { createNativePreviewController } from './src/runtime';
import { TextButton } from './src/ui/components';
import {
  ActivityScreen, ApprovalsScreen, BriefsScreen, ChatScreen, DeviceScreen,
  PairingScreen, ReceiptScreen, UploadsScreen,
} from './src/ui/screens';
import { colors, styles } from './src/ui/styles';
import { authorityLabel, hasOnlineAuthority, run } from './src/ui/view-helpers';

type AppProps = { controller?: CompanionScreenController };
const tabs: { screen: CompanionScreen; title: string }[] = [
  { screen: 'briefs', title: 'Briefs' }, { screen: 'chat', title: 'Chat' },
  { screen: 'uploads', title: 'Uploads' }, { screen: 'approvals', title: 'Approvals' },
  { screen: 'device', title: 'Device' },
];

/** Production hosts inject their fully wired controller; the default is visibly synthetic. */
export default function App({ controller }: AppProps) {
  const [active] = useState(() => controller ?? createNativePreviewController());
  const subscribe = useCallback((listener: () => void) => active.subscribe(listener), [active]);
  const getSnapshot = useCallback(() => active.getState(), [active]);
  const state = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  const [receiptOrigin, setReceiptOrigin] = useState<CompanionScreen>('briefs');
  const [now, setNow] = useState(Date.now());
  const { width } = useWindowDimensions();
  useEffect(() => { run(() => active.start()); }, [active]);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    if (Platform.OS !== 'android') return;
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      if (state.screen === 'receipt') { active.navigate(receiptOrigin); return true; }
      if (state.screen === 'briefs' && state.brief) { active.navigate('briefs'); return true; }
      if (state.screen === 'approvals' && state.approval) { active.navigate('approvals'); return true; }
      if (!['briefs', 'pairing'].includes(state.screen)) { active.navigate('briefs'); return true; }
      return false;
    });
    return () => subscription.remove();
  }, [active, receiptOrigin, state.screen, state.brief, state.approval]);
  const openReceipt = (id: string) => {
    setReceiptOrigin(state.screen === 'receipt' ? receiptOrigin : state.screen);
    run(() => active.openReceipt(id));
  };
  const props = { state, controller: active, now, wide: width >= 700, onReceipt: openReceipt };
  const pending = state.client.requests.filter(request => ['pending', 'unknown', 'cancelling'].includes(request.status)).length;
  const selected = state.screen === 'pairing' || state.screen === 'activity' ? 'device' :
    state.screen === 'receipt' ? receiptOrigin : state.screen;
  return <SafeAreaProvider><SafeAreaView style={styles.safe}>
    <StatusBar barStyle="dark-content" backgroundColor={colors.paper} />
    <KeyboardAvoidingView style={styles.keyboard} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={styles.shell}>
        <View style={styles.header}>
          <View><Text style={styles.eyebrow}>COMPANION</Text><Text style={styles.brand}>chausar.</Text></View>
          <TextButton title={pending ? `Activity · ${pending}` : 'Activity'}
            accessibilityLabel={`Open request activity, ${pending} active requests`}
            onPress={() => active.navigate('activity')} />
        </View>
        {state.mode === 'demo' && <View style={[styles.banner, styles.bannerAmber]}>
          <Text style={styles.bannerText}>SYNTHETIC PREVIEW · Sample data and mock engine. Live pairing is not wired.</Text>
        </View>}
        <View accessibilityLiveRegion="polite" style={[styles.banner,
          !hasOnlineAuthority(state) && styles.bannerAmber,
          state.client.pairing.status === 'revoked' && styles.bannerRed]}>
          <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants"
            style={[styles.connectionDot, !hasOnlineAuthority(state) && styles.offlineDot]} />
          <Text style={styles.bannerText}>{authorityLabel(state)}</Text>
        </View>
        {state.notice && <View accessibilityLiveRegion="polite" style={[styles.notice,
          state.notice.tone === 'error' && styles.noticeError,
          state.notice.tone === 'success' && styles.noticeSuccess]}>
          <Text style={styles.bannerText}>{state.notice.text}</Text>
          <TextButton title="Dismiss" accessibilityLabel="Dismiss message" onPress={() => active.dismissNotice()} />
        </View>}
        <ScrollView key={state.screen} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag" accessibilityLabel={`${state.screen} screen`}>
          {state.busy.length > 0 && <Text accessibilityLiveRegion="polite" style={styles.small}>Checking with your engine…</Text>}
          {state.screen === 'pairing' && <PairingScreen {...props} />}
          {state.screen === 'briefs' && <BriefsScreen {...props} />}
          {state.screen === 'chat' && <ChatScreen {...props} />}
          {state.screen === 'uploads' && <UploadsScreen {...props} />}
          {state.screen === 'approvals' && <ApprovalsScreen {...props} />}
          {state.screen === 'activity' && <ActivityScreen {...props} />}
          {state.screen === 'device' && <DeviceScreen {...props} />}
          {state.screen === 'receipt' && <ReceiptScreen state={state} onBack={() => active.navigate(receiptOrigin)} />}
        </ScrollView>
        <View style={styles.footer}>
          {tabs.map(tab => <Pressable key={tab.screen} onPress={() => active.navigate(tab.screen)}
            accessibilityRole="tab" accessibilityLabel={`Open ${tab.title.toLowerCase()}`}
            accessibilityState={{ selected: selected === tab.screen }}
            style={({ pressed }) => [styles.tab, selected === tab.screen && styles.tabSelected, pressed && styles.buttonPressed]}>
            <View style={[styles.tabMark, selected === tab.screen && styles.tabMarkSelected]} />
            <Text style={[styles.tabLabel, selected === tab.screen && styles.tabLabelSelected]}>{tab.title}</Text>
          </Pressable>)}
        </View>
      </View>
    </KeyboardAvoidingView>
  </SafeAreaView></SafeAreaProvider>;
}
