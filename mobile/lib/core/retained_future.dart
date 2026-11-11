/// Giữ một Future qua các rebuild để ô nhập (TextField/SearchBar) đặt BÊN
/// TRONG FutureBuilder không bị unmount → mất focus / tự đóng bàn phím.
///
/// Nguyên nhân gốc (MO-013): `future: repo.xxx()` tạo mới ngay trong `build`
/// + `onChanged: (_) => setState(...)` trên ô nhập → mỗi ký tự gõ ra là một
/// rebuild → FutureBuilder thấy future mới → rớt về `waiting` → vẽ
/// LoadingList thay cả form → TextField bị unmount → mất focus, bàn phím đóng.
///
/// Luật dùng:
/// - Mỗi State giữ một [RetainedFuture] cho mỗi query, gọi [of] trong build.
/// - Key đổi (đổi user/phone/range) → tự fetch lại.
/// - Muốn tải lại chủ động (retry/poll timer/submit xong): gọi [refresh]
///   trong setState.
/// - Khi fetch lại, [value] giữ dữ liệu cũ để builder vẽ tiếp trong lúc chờ,
///   không rớt về LoadingList (không mất focus, không giật scroll).
///
/// KHÔNG đổi validation/normalize — chỉ đổi vòng đời của Future.
class RetainedFuture<T> {
  RetainedFuture();

  Object? _key;
  Future<T>? _current;

  /// Dữ liệu lần fetch thành công gần nhất (null nếu chưa từng thành công).
  T? value;

  /// Lỗi lần fetch gần nhất (null nếu lần cuối thành công / chưa fetch).
  Object? error;

  /// Future để truyền vào FutureBuilder. Chỉ fetch lại khi [key] đổi hoặc
  /// sau [refresh]; rebuild thường (gõ phím, setState lặt vặt) tái dùng
  /// future cũ nên KHÔNG rớt về `waiting`.
  Future<T> of(Object? key, Future<T> Function() load) {
    if (_current == null || _key != key) {
      _key = key;
      refresh(load);
    }
    return _current!;
  }

  /// Bỏ cache và fetch lại — gọi trong setState (retry, poll, sau submit).
  /// Dữ liệu cũ vẫn nằm ở [value] để UI vẽ tiếp trong lúc chờ.
  void refresh(Future<T> Function() load) {
    final Future<T> f = load();
    _current = f.then<T>(
      (v) {
        value = v;
        error = null;
        return v;
      },
      onError: (Object e) {
        error = e;
        throw e;
      },
    );
  }
}
