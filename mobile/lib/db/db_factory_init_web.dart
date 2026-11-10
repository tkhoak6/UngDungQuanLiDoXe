// Web-only: trỏ factory mặc định của sqflite sang SQLite/WASM
// ([databaseFactoryFfiWeb]: chạy trong SharedWorker, lưu IndexedDB).
// File này CHỈ được biên dịch trên web qua conditional import trong
// `app_db.dart` — mobile/desktop dùng `db_factory_init_stub.dart`.
import 'package:sqflite/sqflite.dart';
import 'package:sqflite_common_ffi_web/sqflite_ffi_web.dart';

/// Gán 1 lần trước mọi `openDatabase`/`getDatabasesPath` khi chạy web.
Future<void> initDatabaseFactory() async {
  databaseFactory = databaseFactoryFfiWeb;
}
