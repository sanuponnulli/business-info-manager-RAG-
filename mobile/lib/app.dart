import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'auth/auth_controller.dart';
import 'auth/login_screen.dart';
import 'home/home_screen.dart';

class AcmeAssistantApp extends StatelessWidget {
  const AcmeAssistantApp({super.key});

  static const _seed = Color(0xFF3557D4);

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'Acme Assistant',
      debugShowCheckedModeBanner: false,
      theme: ThemeData(colorSchemeSeed: _seed, brightness: Brightness.light),
      darkTheme: ThemeData(colorSchemeSeed: _seed, brightness: Brightness.dark),
      home: const _AuthGate(),
    );
  }
}

/// Picks the screen from the sign-in state: a splash while a saved session
/// is checked, then login or home. Signing in or out swaps it automatically.
class _AuthGate extends ConsumerWidget {
  const _AuthGate();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return switch (ref.watch(authProvider)) {
      AsyncData(value: final profile?) => HomeScreen(profile: profile),
      AsyncData() || AsyncError() => const LoginScreen(),
      _ => const Scaffold(body: Center(child: CircularProgressIndicator())),
    };
  }
}
