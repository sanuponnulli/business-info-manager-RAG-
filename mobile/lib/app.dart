import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'auth/auth_controller.dart';
import 'auth/login_screen.dart';
import 'chat/chat_screen.dart';
import 'ui/theme.dart';

class AcmeAssistantApp extends StatelessWidget {
  const AcmeAssistantApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'Acme Assistant',
      debugShowCheckedModeBanner: false,
      theme: buildTheme(Brightness.light),
      darkTheme: buildTheme(Brightness.dark),
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
      AsyncData(value: final profile?) => ChatScreen(profile: profile),
      AsyncData() || AsyncError() => const LoginScreen(),
      _ => const Scaffold(body: Center(child: BrandMark(size: 64))),
    };
  }
}
