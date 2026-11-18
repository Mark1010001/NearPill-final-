import java.util.Properties
import java.io.FileInputStream

plugins {
    id("com.android.application")
    id("dev.flutter.flutter-gradle-plugin")
}

val keystoreProperties = Properties()
val keystorePropertiesFile = rootProject.file("key.properties")
if (keystorePropertiesFile.exists()) {
    FileInputStream(keystorePropertiesFile).use { keystoreProperties.load(it) }
}

val nearPillApplicationId = providers.gradleProperty("NEARPILL_APPLICATION_ID")
    .orElse("dev.nearpill.mobile")
    .get()
val localProperties = Properties()
val localPropertiesFile = rootProject.file("local.properties")
if (localPropertiesFile.exists()) {
    FileInputStream(localPropertiesFile).use { localProperties.load(it) }
}
val mapsApiKey = providers.gradleProperty("MAPS_API_KEY")
    .orElse(System.getenv("MAPS_API_KEY") ?: localProperties.getProperty("MAPS_API_KEY", ""))
    .get()

android {
    namespace = "dev.nearpill.mobile"
    compileSdk = flutter.compileSdkVersion
    ndkVersion = flutter.ndkVersion

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    defaultConfig {
        applicationId = nearPillApplicationId
        minSdk = flutter.minSdkVersion
        targetSdk = flutter.targetSdkVersion
        versionCode = flutter.versionCode
        versionName = flutter.versionName
        manifestPlaceholders["MAPS_API_KEY"] = mapsApiKey
    }

    signingConfigs {
        if (keystorePropertiesFile.exists()) {
            create("release") {
                keyAlias = keystoreProperties["keyAlias"] as String
                keyPassword = keystoreProperties["keyPassword"] as String
                storeFile = file(keystoreProperties["storeFile"] as String)
                storePassword = keystoreProperties["storePassword"] as String
            }
        }
    }

    buildTypes {
        release {
            if (keystorePropertiesFile.exists()) {
                signingConfig = signingConfigs.getByName("release")
            }
        }
    }
}

kotlin {
    compilerOptions {
        jvmTarget = org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17
    }
}

flutter {
    source = "../.."
}

tasks.configureEach {
    if (name.contains("Release", ignoreCase = true)) {
        doFirst {
            if (nearPillApplicationId == "dev.nearpill.mobile") {
                throw GradleException(
                    "Set -PNEARPILL_APPLICATION_ID to the owner-approved production package ID before a release build."
                )
            }
            if (!keystorePropertiesFile.exists()) {
                throw GradleException(
                    "android/key.properties is required for release signing; debug signing is not permitted."
                )
            }
            if (mapsApiKey.isBlank()) {
                throw GradleException(
                    "Set MAPS_API_KEY in android/local.properties or the build environment before a release build."
                )
            }
        }
    }
}
