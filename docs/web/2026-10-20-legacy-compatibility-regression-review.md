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

## Theo dõi: HDR mất khi zoom trong Photos

Người dùng xác nhận bản Portrait đã sửa hoạt động: xem ảnh và vào Sửa có HDR,
Styles/Texture và Portrait được nhận. Lỗi mới là zoom làm HDR biến mất cho đến
khi đóng riêng ảnh rồi mở lại. JPEG Indigo gốc không có lỗi zoom này.

`IMG_1998.HEIC` được gửi để đối chiếu vẫn chứa gain map Apple 1512×2016,
12 tile, `HDRGainMapVersion=131072`, headroom 8. File này có cấu trúc của bản
render đã ghi lại: không còn tmap/Styles/depth như file Stylio 11 MB ban đầu.
Không được suy từ sự thiếu control trong bản render này thành việc Portrait
trên tài sản Photos bị mất; người dùng đã xác nhận Portrait hoạt động.

Đối chiếu `9e3172e...fe1cce1` cho thấy `raster-import.js`, `jpeg-hdr.js`,
`ai-portrait-export.js`, `ai-portrait-source.js`, `hdr-compatibility.js` không
thay đổi trong nhánh legacy. Thay đổi ở bộ đọc HEIF dùng chung chỉ bổ sung
kích thước scalar TIFF. Đợt thay đổi biểu diễn HDR RGB Indigo được ghi ở commit
`1285101`, sau nhánh legacy. Chưa có tái hiện trên thiết bị để quy chính xác
lỗi zoom cho một commit; không rollback nhánh legacy dựa trên triệu chứng này.

Đã tạo ba đối chứng tách biến bằng `tools/indigo-zoom-hdr-candidates.mjs`:
A nhập lại nguyên file render, B chỉ bỏ nhóm ưu tiên bản HDR, C giữ các pixel
gain map RGB chính xác nhưng đổi lưới 12 tile thành một ảnh HEVC lossless.
B/C giữ nguyên payload ảnh, ISO HDR, Styles, Texture và depth. Xác nhận zoom
trên Photos iPhone còn chờ; chưa sửa pipeline chính theo giả thuyết.

Phản hồi tiếp theo: A vẫn lỗi; cảnh cũ có HDR quá yếu để kết luận từ B/C
(headroom nguồn chỉ 0,107 stop). Đã thay bằng ảnh Indigo
`IDG_20261019_201808_176.JPEG` do người dùng cung cấp, HDR 3,257 stop và có
highlight vượt SDR trong dữ liệu thực. Bộ D/E/F gồm một bản xuất app thật và
hai biến thể tương ứng, cùng một ảnh mới. Chưa có kết quả zoom của D/E/F;
không dùng B/C cũ để quy nguyên nhân hoặc sửa pipeline chính.

## Kiểm tra thực thi trước/sau merge trên cùng ảnh

D/E/F trên ảnh HDR mới đều vẫn mất HDR khi zoom. Đã chạy lại chính luồng
chuyển JPEG sang HEIC trong trình duyệt bằng toàn bộ `web/src` ở hai snapshot
Git độc lập: `9e3172e` trước merge và `76182ae` ngay khi merge. Cùng JPEG,
cùng tùy chọn không AI Detail, cùng bộ mã hóa thật và runtime assets không đổi.
Hai file đều 8.853.904 byte, **giống nhau toàn bộ byte**, SHA-256
`04e874343bf94cafa57fdf583dde366529a89dc5d70c0156b22f910e7e31ae07`.
Code `web/src` ở merge cũng giống hệt đầu nhánh `fe1cce1`.

Với ca chuyển JPEG này, không có thay đổi đầu ra do merge. Giới hạn kết luận:
chưa chứng minh code cũ zoom đúng trên iPhone; phép thử này không đại diện cho
mọi đường UI/queue/HEIC recovery. So với code hiện tại, các tile ảnh và ISO HDR,
tmap, Styles và linear thumbnail vẫn giữ nguyên từng byte; phần bổ sung nổi bật
là tài nguyên HDR Apple RGB riêng và khai báo đi kèm ở commit sau merge `1285101`.
Đây là vùng nghi vấn, chưa phải nguyên nhân zoom được chứng minh.

Đã tạo G (đầu ra code trước merge) và H (đầu ra code hiện tại), cùng ảnh mới và
cùng Styles+Texture chưa thêm Portrait, để xác nhận hành vi View/Zoom trên thiết
bị. Không rollback code hay sửa pipeline Native để chạy phép đối chiếu này.

Kết quả iPhone: G không hiển thị HDR; H có HDR nhưng mất khi zoom. Vì vậy,
code cũ chưa hỗ trợ đúng HDR của chính ảnh Indigo mới này, còn lỗi zoom đã
xuất hiện ở bước xuất HDR hiện tại trước khi thêm Portrait. Đợt sửa HDR sau
merge cải thiện khả năng hỗ trợ nhưng chưa hoàn chỉnh cho zoom; chưa xác định
dòng code gây lỗi. Ba đối chứng tiếp theo I/J/K tách lựa chọn ảnh chính, gain
map một kênh và đường ISO riêng; chưa có bản nào được chấp nhận hay đưa vào
pipeline chính.

Tiếp theo I/K không hiển thị HDR; J có HDR nhưng vẫn mất khi zoom. Đối chiếu
bộ mã hóa phát hiện app thiếu `total-frames=1` khi gọi x265, khiến các tile RGB
khai báo Main video/level 255 thay vì cấu hình ảnh tĩnh. Đã tạo O từ snapshot
code hiện tại chỉ bổ sung tham số này; toàn bộ payload ảnh, HDR, Styles/Texture,
các thuộc tính ngoài hvcC và quan hệ giữa tài nguyên đều giống hệt H. Đây là
nghi vấn có phép đối chiếu cụ thể, chưa phải nguyên nhân zoom đã xác nhận.
Code production chưa thay đổi; còn chờ kiểm chứng O trên iPhone.

Kết quả mới: O và M vẫn mất HDR khi zoom. L/N màu nhạt hơn và cũng vẫn lỗi.
Vì N đã bỏ toàn bộ Styles/Texture/Portrait cùng tmap, các tài nguyên này không
phải điều kiện cần gây lỗi. Thay cấu hình ảnh tĩnh cũng chưa giải quyết được.
Không đưa các phép thử này vào pipeline chính.

P/Q tiếp tục tách bước Photos đọc ảnh nền ở độ phân giải đầy đủ. P ghép chính
xác giá trị Y/U/V của 48 tile thành một ảnh HEVC lossless 4032×3024, giữ lớp
grid một ô. Q dùng cùng ảnh đó làm primary trực tiếp. Cả hai giữ nguyên từng
byte các tài nguyên HDR, Styles, Texture và các tham chiếu đến ảnh chính.
P qua kiểm tra read worker; Q là đối chứng định dạng nằm ngoài khả năng nhập
primary trực tiếp của app hiện tại. Chưa có kết quả zoom trên iPhone; chưa
thay đổi luồng Native hay xuất ảnh chính thức.

## Bản ổn định được chấp nhận

Người dùng xác nhận P/Q vẫn mất HDR khi zoom và còn sai màu khi áp dụng
Styles/Texture, nên dừng thử nghiệm và yêu cầu commit bản ổn định nhất.
Không áp dụng các thay đổi định dạng P/Q hoặc cấu hình mã hóa thử nghiệm.

Giữ code production tại `13df341`: đường HDR RGB Adobe đã được chấp nhận
ở `1285101`/`818674e`, cùng bản sửa nguồn ảnh Portrait và khóa lưu. Đây là
luồng tạo H (Styles/Texture) và D (Portrait) trên cảnh HDR mới, chưa sửa zoom.
Chấp nhận tạm thời HDR mất sau zoom cho đến khi đóng ảnh rồi mở lại; không
chủ động loại HDR khỏi file. Luồng ảnh gốc Native tiếp tục giữ nguyên.

Các kiểm tra pixel/cấu trúc P/Q chỉ chứng minh dữ liệu được giữ, không chứng
minh màu khi áp dụng Styles trong Photos. Kết quả thiết bị đã bác bỏ chúng.
Toàn bộ ảnh cá nhân, file đối chứng và snapshot tiếp tục lưu riêng ngoài Git.

Kiểm tra bản chốt: 160 kiểm thử qua, 13 fixture tùy chọn thiếu được bỏ qua,
không có lỗi. Hai đối chứng ảnh gốc Bright và HDR-native chạy thật và qua.
Kiểm tra PWA và ba ngôn ngữ đều qua. Chạy lại luồng chuyển đổi trong trình
duyệt trên JPEG HDR mới tạo file giống H toàn bộ byte (11.412.831 byte), xác
nhận bản chốt dùng đúng luồng đã chọn. Đây không phải xác nhận đã sửa zoom.
