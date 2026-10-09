fn main() {
    println!("cargo:rerun-if-changed=Info.plist");
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("macos") {
        let plist = std::path::PathBuf::from(std::env::var_os("CARGO_MANIFEST_DIR").unwrap())
            .join("Info.plist");
        // Standalone CLI metadata lives in the Mach-O, not an app bundle.
        for argument in ["-sectcreate", "__TEXT", "__info_plist"] {
            println!("cargo:rustc-link-arg=-Wl,{argument}");
        }
        println!("cargo:rustc-link-arg=-Wl,{}", plist.display());
    }
}
