import 'package:flutter/material.dart';

/// Design tokens — 1-1 với DESIGN.md §2–§9 + mapping §10.
/// Không thêm màu ngoài tokens.
class AppColors {
  AppColors._();

  static const primary = Color(0xFF1677FF);
  static const secondary = Color(0xFF8B5CF6);
  static const success = Color(0xFF16A34A);
  static const warning = Color(0xFFD97706);
  static const danger = Color(0xFFDC2626);
  static const surface = Color(0xFFFFFFFF);
  static const text = Color(0xFF111827);

  // Tint nền badge/card (không white-on-tint).
  static const primaryTint = Color(0x1A1677FF);
  static const successTint = Color(0x1416A34A);
  static const warningTint = Color(0x1AD97706);
  static const dangerTint = Color(0x14DC2626);

  // Text trên tint — đạt tương phản ≥4.5:1 (§10.1).
  static const successText = Color(0xFF15803D);
  static const warningText = Color(0xFF92400E);
}

/// Spacing scale 4/8/12/16/24/32 — không phát minh số khác.
class AppGaps {
  AppGaps._();

  static const double s4 = 4;
  static const double s8 = 8;
  static const double s12 = 12;
  static const double s16 = 16;
  static const double s24 = 24;
  static const double s32 = 32;
}

/// Type scale mobile: AppBar 18/semibold, card title 16, body 14, helper 12.
class AppText {
  AppText._();

  static const appBar = TextStyle(fontSize: 18, fontWeight: FontWeight.w600);
  static const cardTitle =
      TextStyle(fontSize: 16, fontWeight: FontWeight.w600);
  static const body = TextStyle(fontSize: 14);
  static const helper = TextStyle(fontSize: 12);
  static const tabLabel =
      TextStyle(fontSize: 12, fontWeight: FontWeight.w500);

  static TextStyle mono(double size, {FontWeight weight = FontWeight.w400}) {
    return TextStyle(
      fontFamily: 'JetBrains Mono',
      fontFamilyFallback: const ['monospace'],
      fontFeatures: const [FontFeature.tabularFigures()],
      fontSize: size,
      fontWeight: weight,
    );
  }
}

/// Mapping trạng thái chỗ → màu (DESIGN.md §10.1).
enum SpotUiState { free, occupied, maintenance }

class SpotUi {
  SpotUi._();

  static Color fill(SpotUiState s, {required bool highContrast}) {
    switch (s) {
      case SpotUiState.free:
        return highContrast ? AppColors.successTint : AppColors.successTint;
      case SpotUiState.occupied:
        return AppColors.primary;
      case SpotUiState.maintenance:
        return const Color(0x11111827);
    }
  }

  static Color border(SpotUiState s) {
    switch (s) {
      case SpotUiState.free:
        return AppColors.success;
      case SpotUiState.occupied:
        return AppColors.primary;
      case SpotUiState.maintenance:
        return AppColors.danger;
    }
  }

  static String semanticLabel(String spotNumber, SpotUiState s) {
    switch (s) {
      case SpotUiState.free:
        return '$spotNumber: trống';
      case SpotUiState.occupied:
        return '$spotNumber: đang đỗ';
      case SpotUiState.maintenance:
        return '$spotNumber: bảo trì';
    }
  }
}
