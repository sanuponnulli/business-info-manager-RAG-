import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../auth/auth_controller.dart';
import '../auth/profile.dart';

/// Signed-in home. For now it shows who you are; the chat screen replaces
/// the body in chunk 2.
class HomeScreen extends ConsumerWidget {
  const HomeScreen({super.key, required this.profile});

  final Profile profile;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final theme = Theme.of(context);
    return Scaffold(
      appBar: AppBar(
        title: const Text('Acme Assistant'),
        actions: [
          IconButton(
            tooltip: 'Sign out',
            icon: const Icon(Icons.logout),
            onPressed: () => ref.read(authProvider.notifier).signOut(),
          ),
        ],
      ),
      body: Center(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              CircleAvatar(radius: 32, child: Text(profile.firstName[0], style: theme.textTheme.headlineSmall)),
              const SizedBox(height: 16),
              Text(profile.fullName, style: theme.textTheme.titleLarge),
              Text('${profile.jobTitle} · ${profile.department}', style: theme.textTheme.bodyMedium),
              const SizedBox(height: 12),
              Chip(label: Text(profile.role.label)),
            ],
          ),
        ),
      ),
    );
  }
}
