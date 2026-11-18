package dev.nearpill.mobile

import android.app.Activity
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Matrix
import android.media.ExifInterface
import io.flutter.embedding.android.FlutterActivity
import io.flutter.embedding.engine.FlutterEngine
import io.flutter.plugin.common.MethodChannel
import java.io.ByteArrayOutputStream

class MainActivity : FlutterActivity() {
    private var photoResult: MethodChannel.Result? = null
    private val photoRequestCode = 2301


    private val acceptedTypes = setOf("image/jpeg", "image/png", "image/heic", "image/heif")
    private val maxInputBytes = 25 * 1024 * 1024
    private val maxUploadBytes = 1_000_000 // below the server's 1,048,576-byte limit
    private val maxSide = 1600
    private val minSide = 640

    // Decode (honouring EXIF rotation), scale down, and re-encode as JPEG until it fits the upload limit.
    private fun shrinkToJpeg(source: ByteArray): ByteArray {
        val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        BitmapFactory.decodeByteArray(source, 0, source.size, bounds)
        require(bounds.outWidth > 0 && bounds.outHeight > 0)
        var sample = 1
        while (maxOf(bounds.outWidth, bounds.outHeight) / (sample * 2) >= maxSide) sample *= 2
        val decoded = BitmapFactory.decodeByteArray(source, 0, source.size, BitmapFactory.Options().apply { inSampleSize = sample })
            ?: error("Undecodable photo")
        val rotation = when (ExifInterface(source.inputStream()).getAttributeInt(ExifInterface.TAG_ORIENTATION, ExifInterface.ORIENTATION_NORMAL)) {
            ExifInterface.ORIENTATION_ROTATE_90 -> 90f
            ExifInterface.ORIENTATION_ROTATE_180 -> 180f
            ExifInterface.ORIENTATION_ROTATE_270 -> 270f
            else -> 0f
        }
        var scale = minOf(1f, maxSide.toFloat() / maxOf(decoded.width, decoded.height))
        while (true) {
            val matrix = Matrix().apply { postRotate(rotation); postScale(scale, scale) }
            val scaled = Bitmap.createBitmap(decoded, 0, 0, decoded.width, decoded.height, matrix, true)
            // JPEG has no alpha: flatten transparent PNGs onto white.
            val flat = Bitmap.createBitmap(scaled.width, scaled.height, Bitmap.Config.ARGB_8888)
            Canvas(flat).apply { drawColor(Color.WHITE); drawBitmap(scaled, 0f, 0f, null) }
            for (quality in intArrayOf(85, 75, 65, 55, 45)) {
                val out = ByteArrayOutputStream()
                flat.compress(Bitmap.CompressFormat.JPEG, quality, out)
                if (out.size() <= maxUploadBytes) return out.toByteArray()
            }
            require(maxOf(flat.width, flat.height) > minSide)
            scale *= 0.8f
        }
    }

    override fun configureFlutterEngine(flutterEngine: FlutterEngine) {
        super.configureFlutterEngine(flutterEngine)
        MethodChannel(flutterEngine.dartExecutor.binaryMessenger, "nearpill/prescription_photo")
            .setMethodCallHandler { call, result ->
                if (call.method != "pick") {
                    result.notImplemented()
                } else if (photoResult != null) {
                    result.error("busy", "A photo is already being selected.", null)
                } else {
                    photoResult = result
                    try {
                        val picker = Intent(Intent.ACTION_OPEN_DOCUMENT).apply {
                            addCategory(Intent.CATEGORY_OPENABLE)
                            type = "image/*"
                            putExtra(Intent.EXTRA_MIME_TYPES, arrayOf("image/jpeg", "image/png", "image/heic", "image/heif"))
                        }
                        startActivityForResult(picker, photoRequestCode)
                    } catch (_: Exception) {
                        photoResult = null
                        result.error("picker_unavailable", "The photo picker is unavailable.", null)
                    }
                }
            }
    }

    @Deprecated("Uses the FlutterActivity document picker callback")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        if (requestCode != photoRequestCode) return
        val result = photoResult ?: return
        val uri = data?.data
        if (resultCode != Activity.RESULT_OK || uri == null) {
            photoResult = null
            result.success(null)
            return
        }
        Thread {
            try {
                val mimeType = contentResolver.getType(uri)
                require(mimeType in acceptedTypes)
                val source = contentResolver.openInputStream(uri)?.use { input ->
                    val output = ByteArrayOutputStream()
                    val buffer = ByteArray(8192)
                    while (true) {
                        val count = input.read(buffer)
                        if (count < 0) break
                        require(output.size() + count <= maxInputBytes)
                        output.write(buffer, 0, count)
                    }
                    output.toByteArray()
                } ?: error("Unreadable photo")
                require(source.isNotEmpty())
                val bytes = shrinkToJpeg(source)
                runOnUiThread {
                    photoResult = null
                    result.success(mapOf("mimeType" to "image/jpeg", "bytes" to bytes))
                }
            } catch (_: Exception) {
                runOnUiThread {
                    photoResult = null
                    result.error("invalid_photo", "Choose a readable JPG, PNG or HEIC photo.", null)
                }
            }
        }.start()
    }
}
