/// Format tiền/ngày — dùng thủ công để không phụ thuộc intl.
String vnd(int amount) {
  final s = amount.toString();
  final buf = StringBuffer();
  var count = 0;
  for (var i = s.length - 1; i >= 0; i--) {
    buf.write(s[i]);
    count++;
    if (count % 3 == 0 && i != 0) buf.write('.');
  }
  return '${buf.toString().split('').reversed.join()} ₫';
}

String _two(int n) => n.toString().padLeft(2, '0');

String fmtDate(DateTime d) => '${_two(d.day)}/${_two(d.month)}/${d.year}';

String fmtTime(DateTime d) => '${_two(d.hour)}:${_two(d.minute)}';

String fmtDateTime(DateTime d) => '${fmtDate(d)} ${fmtTime(d)}';

String elapsedLabel(Duration d) {
  if (d.inMinutes < 60) return '${d.inMinutes}p';
  final h = d.inHours;
  final m = d.inMinutes % 60;
  return m == 0 ? '${h}h' : '${h}h${m}p';
}
