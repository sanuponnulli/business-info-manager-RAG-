import 'package:flutter/foundation.dart';

/// Where the backend runs. Override it at build time:
///
///   flutter run --dart-define=API_BASE_URL=http://192.168.1.20:3000
///
/// Without it: the Android emulator reaches the Mac at 10.0.2.2, the iOS
/// simulator at localhost. A real phone needs the Mac's LAN address.
Uri apiBaseUrl() {
  const fromEnv = String.fromEnvironment('API_BASE_URL');
  if (fromEnv.isNotEmpty) return Uri.parse(fromEnv);
  final host = defaultTargetPlatform == TargetPlatform.android ? '10.0.2.2' : 'localhost';
  return Uri.parse('http://$host:3000');
}

/// Show one-tap demo sign-ins on the login screen (the seeded Acme users).
/// Handy for a portfolio demo; build with --dart-define=DEMO_ACCOUNTS=false to hide them.
const showDemoAccounts = bool.fromEnvironment('DEMO_ACCOUNTS', defaultValue: true);
