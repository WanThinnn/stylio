# Rà soát hồi quy sau nhánh Legacy Compatibility Export

Phạm vi: `9e3172e...fe1cce1` (nhánh `feature/legacy-compatibility-export`),
đối chiếu với `master` tại `818674e`. Nhánh gồm phần tương thích HEIC,
hàng đợi, xử lý song song, PWA và giao diện. Kiểm tra này tập trung vào lỗi
thực thi và bảo toàn ảnh, không khẳng định đã kiểm chứng mọi thiết bị iOS.

## Standards

Không thấy vi phạm quy định viết code được tài liệu hóa. Có một lỗi vòng đời
trạng thái **P2**, được đưa vào ở commit `edc1ef25`:

- Bật Portrait sau khi ảnh xử lý xong đặt `outputPending(true)` trong
  `web/src/app/application.js`, nhưng bộ điều khiển Portrait không gỡ khóa khi
  hoàn tất. Thành công, thất bại hoặc hủy đều có thể để nút lưu/tải bị khóa;
  bản dự phòng vẫn được xuất nhưng trạng thái khóa tiếp tục được áp dụng.
- Đã tái hiện bằng chính bộ điều khiển, thay phần AI/codec bằng kết quả có kiểm
  soát. Ba kiểm thử thất bại trước sửa và qua sau sửa. Kiểm thử thứ tư bảo đảm
  vẫn khóa đúng khi bản xem trước đang thật sự cập nhật thông số.
- Sửa local: gỡ khóa hàng đợi trong `finally`; giữ khóa nếu còn một tác vụ cập
  nhật preview hợp lệ. Đây là một thay đổi trạng thái chưa được khép kín giữa
  application và controller, không phải lỗi ghi pixel/HDR.

## Spec

Không thấy yêu cầu thiết kế nào bị vi phạm trong phạm vi đã kiểm tra. Thiết kế
ghi rõ `known-compatible → existing native pipeline, unchanged` và
`non-native → existing non-native/raster pipeline, unchanged`
(`docs/superpowers/specs/2026-10-15-legacy-compatibility-export-design.md`,
dòng 796). Luồng JPEG vẫn gọi Portrait ở nhánh raster trước khi tới phần
phân loại/tương thích HEIC; luồng HEIC đã biết vẫn gọi Portrait bình thường.

Việc bỏ Soft Skin/Portrait sau lần chuyển đổi đầu tiên của một hợp đồng Apple
chưa biết là giới hạn được thiết kế yêu cầu: `a frozen postflight boundary with
no HDR/Soft Skin/AI Portrait mutation afterward`. Điều đó không giải thích
ảnh JPEG Indigo bị thiếu depth. Kiểm tra phân loại 411 HEIC riêng tư không có
lỗi parse/fingerprint; 20 trường hợp unknown đều là biến thể nghiên cứu có
thay đổi hợp đồng. Chưa chứng minh được một ảnh gốc từng được hỗ trợ bị chuyển
nhầm sang nhánh phục hồi bởi lần merge này.

## Liên hệ với IMG_1995

`IMG_1995.HEIC` có Styles, Texture, HDR ISO và HDR Apple, nhưng không có depth.
Bước ráp Portrait hoạt động khi được cung cấp depth hợp lệ. Có thể tái hiện
một đường thất bại trước đó: `ImageBitmap` từ chối JPEG, sau đó code đưa JPEG
vào bộ giải mã HEIC và AI thất bại. Giao diện giữ bản Styles-only làm dự phòng.

Đoạn này đã tồn tại trong `ai-portrait-source.js` từ `4d3f742` ngày 10/10,
trước nhánh Legacy Compatibility. Đã sửa local bằng đường HTML image decoder
cho ảnh raster; đường HEIC giữ nguyên. Trên trình duyệt thật, ép đúng điều kiện
ImageBitmap từ chối và chạy controller + model Lite + encoder/assembler thật
đã tạo được depth 768×1024. Toàn bộ tile ảnh, hai gain map HDR, Styles, Texture,
profile màu và thông số Style gốc được giữ nguyên. Chưa có log lỗi từ iPhone
để khẳng định đây là nguyên nhân duy nhất của lần xử lý IMG_1995.

Tổng kết hai trục: **Standards: 1 lỗi trạng thái đã sửa; Spec: 0 vi phạm được
chứng minh**. Nhận diện Lighting/Depth và HDR sau lưu trong Photos cần xác nhận
bằng bản xuất mới trên iPhone.
