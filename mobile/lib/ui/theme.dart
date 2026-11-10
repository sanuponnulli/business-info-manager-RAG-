import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';

/// The one brand colour. It marks what you can tap; everything else is grey.
const brandBlue = Color(0xFF3557D4);

/// iOS-like foundations on top of Material: neutral greys instead of tinted
/// surfaces, system type sizes with SF tracking, hairline separators.
ThemeData buildTheme(Brightness brightness) {
  final dark = brightness == Brightness.dark;
  final scheme = ColorScheme.fromSeed(seedColor: brandBlue, brightness: brightness).copyWith(
    // Dark mode: a brighter blue that still carries white text (4.8:1).
    primary: dark ? const Color(0xFF4565F0) : brandBlue,
    onPrimary: Colors.white,
    surface: dark ? Colors.black : Colors.white,
    onSurface: dark ? Colors.white : const Color(0xFF111114),
    onSurfaceVariant: dark ? const Color(0xFF98989F) : const Color(0xFF6E6E73),
    surfaceContainerLowest: dark ? Colors.black : Colors.white,
    surfaceContainerLow: dark ? const Color(0xFF111113) : const Color(0xFFF7F7F9),
    // Grouped sections and input fields.
    surfaceContainer: dark ? const Color(0xFF1C1C1E) : const Color(0xFFF2F2F7),
    // The user's question bubble.
    surfaceContainerHigh: dark ? const Color(0xFF2C2C2E) : const Color(0xFFE9E9EB),
    surfaceContainerHighest: dark ? const Color(0xFF3A3A3C) : const Color(0xFFE3E3E8),
    outline: dark ? const Color(0xFF545458) : const Color(0xFFC6C6C8),
    outlineVariant: dark ? const Color(0xFF38383A) : const Color(0xFFDCDCE0),
    error: dark ? const Color(0xFFFF6961) : const Color(0xFFD70015),
    surfaceTint: Colors.transparent,
  );
  final ios = defaultTargetPlatform == TargetPlatform.iOS || defaultTargetPlatform == TargetPlatform.macOS;
  final text = _textTheme.apply(bodyColor: scheme.onSurface, displayColor: scheme.onSurface);

  return ThemeData(
    colorScheme: scheme,
    textTheme: text,
    scaffoldBackgroundColor: scheme.surface,
    splashFactory: ios ? NoSplash.splashFactory : InkRipple.splashFactory,
    highlightColor: scheme.onSurface.withValues(alpha: 0.06),
    appBarTheme: AppBarTheme(
      backgroundColor: scheme.surface,
      foregroundColor: scheme.onSurface,
      surfaceTintColor: Colors.transparent,
      elevation: 0,
      scrolledUnderElevation: 0,
      centerTitle: true,
      titleTextStyle: text.titleMedium,
    ),
    dividerTheme: DividerThemeData(color: scheme.outlineVariant, thickness: 0.5, space: 0.5),
    filledButtonTheme: FilledButtonThemeData(
      style: FilledButton.styleFrom(
        minimumSize: const Size(64, 50),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
        textStyle: text.labelLarge,
      ),
    ),
    textButtonTheme: TextButtonThemeData(style: TextButton.styleFrom(textStyle: text.bodyMedium?.copyWith(fontWeight: FontWeight.w600))),
    popupMenuTheme: PopupMenuThemeData(
      color: dark ? scheme.surfaceContainerHigh : scheme.surface,
      elevation: 8,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
    ),
    bottomSheetTheme: BottomSheetThemeData(
      backgroundColor: dark ? scheme.surfaceContainer : scheme.surface,
      surfaceTintColor: Colors.transparent,
      dragHandleColor: scheme.outline,
      shape: const RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(22))),
    ),
    progressIndicatorTheme: ProgressIndicatorThemeData(color: scheme.onSurfaceVariant),
  );
}

TextStyle _style(double size, double leading, FontWeight weight, double tracking) =>
    TextStyle(fontSize: size, height: leading / size, fontWeight: weight, letterSpacing: tracking);

/// Apple's text styles (size / leading / tracking in points).
final _textTheme = TextTheme(
  headlineLarge: _style(34, 41, FontWeight.w700, 0.37), // Large Title
  headlineMedium: _style(28, 34, FontWeight.w700, 0.36), // Title 1
  headlineSmall: _style(22, 28, FontWeight.w700, -0.26), // Title 2
  titleLarge: _style(20, 25, FontWeight.w600, -0.45), // Title 3
  titleMedium: _style(17, 22, FontWeight.w600, -0.43), // Headline
  titleSmall: _style(15, 20, FontWeight.w600, -0.23),
  bodyLarge: _style(17, 22, FontWeight.w400, -0.43), // Body
  bodyMedium: _style(15, 20, FontWeight.w400, -0.23), // Subheadline
  bodySmall: _style(13, 18, FontWeight.w400, -0.08), // Footnote
  labelLarge: _style(17, 22, FontWeight.w600, -0.43), // buttons
  labelMedium: _style(13, 18, FontWeight.w500, -0.08),
  labelSmall: _style(12, 16, FontWeight.w500, 0),
);

/// The app's mark: an open handbook with a bookmark, on the brand blue (same drawing as the
/// app icon, see tool/draw_icon.swift). Decorative, so hidden from VoiceOver.
class BrandMark extends StatelessWidget {
  const BrandMark({super.key, this.size = 24});

  final double size;

  @override
  Widget build(BuildContext context) =>
      ExcludeSemantics(child: CustomPaint(size: Size.square(size), painter: const _BrandMarkPainter()));
}

class _BrandMarkPainter extends CustomPainter {
  const _BrandMarkPainter();

  @override
  void paint(Canvas canvas, Size size) {
    final s = size.width;
    canvas.drawRRect(RRect.fromRectAndRadius(Offset.zero & size, Radius.circular(s * 0.225)), Paint()..color = brandBlue);

    void fill(List<(double, double)> points, Color color) {
      final path = Path()..moveTo(points.first.$1 * s, points.first.$2 * s);
      for (final (x, y) in points.skip(1)) {
        path.lineTo(x * s, y * s);
      }
      canvas.drawPath(path..close(), Paint()..color = color);
    }

    // An open book: two pages meeting at the spine, and a bookmark ribbon.
    fill([(0.19, 0.30), (0.48, 0.35), (0.48, 0.75), (0.19, 0.70)], Colors.white);
    fill([(0.52, 0.35), (0.81, 0.30), (0.81, 0.70), (0.52, 0.75)], Colors.white);
    fill([(0.63, 0.31), (0.73, 0.296), (0.73, 0.55), (0.68, 0.51), (0.63, 0.55)], const Color(0xFFFFC43D));
  }

  @override
  bool shouldRepaint(_BrandMarkPainter oldDelegate) => false;
}

/// An inset grouped list, as in iOS Settings: a header, rounded rows with
/// hairlines between them, and an optional footer.
class GroupedSection extends StatelessWidget {
  const GroupedSection({super.key, this.header, this.footer, required this.children});

  final String? header;
  final String? footer;
  final List<Widget> children;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final secondary = theme.textTheme.bodySmall?.copyWith(color: theme.colorScheme.onSurfaceVariant);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        if (header != null)
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 0, 16, 7),
            child: Semantics(header: true, child: Text(header!, style: theme.textTheme.titleSmall?.copyWith(color: theme.colorScheme.onSurfaceVariant))),
          ),
        ClipRRect(
          borderRadius: BorderRadius.circular(14),
          child: ColoredBox(
            color: theme.colorScheme.surfaceContainer,
            child: Column(
              children: [
                for (var i = 0; i < children.length; i++) ...[
                  if (i > 0) const Divider(indent: 56),
                  children[i],
                ],
              ],
            ),
          ),
        ),
        if (footer != null) Padding(padding: const EdgeInsets.fromLTRB(16, 7, 16, 0), child: Text(footer!, style: secondary)),
      ],
    );
  }
}

/// One tappable row in a [GroupedSection].
class GroupedRow extends StatelessWidget {
  const GroupedRow({super.key, required this.leading, required this.title, this.subtitle, this.chevron = false, this.onTap});

  final Widget leading;
  final String title;
  final String? subtitle;
  final bool chevron;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Material(
      type: MaterialType.transparency,
      child: InkWell(
        onTap: onTap,
        child: ConstrainedBox(
          constraints: const BoxConstraints(minHeight: 52),
          child: Padding(
            padding: const EdgeInsets.fromLTRB(16, 10, 12, 10),
            child: Row(
              children: [
                SizedBox(width: 28, child: Center(child: leading)),
                const SizedBox(width: 12),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Text(title, style: theme.textTheme.bodyLarge),
                      if (subtitle != null)
                        Text(subtitle!, style: theme.textTheme.bodyMedium?.copyWith(color: theme.colorScheme.onSurfaceVariant)),
                    ],
                  ),
                ),
                if (chevron) Icon(Icons.chevron_right, size: 22, color: theme.colorScheme.outline),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

/// Initials in a grey circle, like Contacts.
class Monogram extends StatelessWidget {
  const Monogram({super.key, required this.name, this.size = 32});

  final String name;
  final double size;

  @override
  Widget build(BuildContext context) {
    final initials = name.split(' ').where((w) => w.isNotEmpty).take(2).map((w) => w[0]).join();
    return ExcludeSemantics(
      child: Container(
        width: size,
        height: size,
        alignment: Alignment.center,
        decoration: const BoxDecoration(
          shape: BoxShape.circle,
          gradient: LinearGradient(begin: Alignment.topCenter, end: Alignment.bottomCenter, colors: [Color(0xFFA6ABB7), Color(0xFF858A96)]),
        ),
        child: Text(
          initials,
          style: TextStyle(color: Colors.white, fontSize: size * 0.4, fontWeight: FontWeight.w600, letterSpacing: 0.2),
        ),
      ),
    );
  }
}

/// Three pulsing dots while an answer is on its way. Still when the system
/// asks for reduced motion.
class TypingDots extends StatefulWidget {
  const TypingDots({super.key});

  @override
  State<TypingDots> createState() => _TypingDotsState();
}

class _TypingDotsState extends State<TypingDots> with SingleTickerProviderStateMixin {
  late final _controller = AnimationController(vsync: this, duration: const Duration(milliseconds: 1200));

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    if (MediaQuery.disableAnimationsOf(context)) {
      _controller.stop();
    } else if (!_controller.isAnimating) {
      _controller.repeat();
    }
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final color = Theme.of(context).colorScheme.onSurfaceVariant;
    return Semantics(
      label: 'Thinking',
      child: AnimatedBuilder(
        animation: _controller,
        builder: (context, _) => Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            for (var i = 0; i < 3; i++)
              Padding(
                padding: const EdgeInsets.symmetric(horizontal: 2.5),
                child: Opacity(
                  opacity: _dotOpacity(i),
                  child: Container(width: 7, height: 7, decoration: BoxDecoration(color: color, shape: BoxShape.circle)),
                ),
              ),
          ],
        ),
      ),
    );
  }

  double _dotOpacity(int i) {
    if (!_controller.isAnimating) return 0.6;
    final t = (_controller.value - i * 0.18) % 1.0;
    return 0.3 + 0.7 * (t < 0.5 ? t * 2 : (1 - t) * 2);
  }
}
