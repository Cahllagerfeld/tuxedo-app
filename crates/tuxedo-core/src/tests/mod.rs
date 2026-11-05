//! Unit tests, one module per topic. Shared fixtures live here.

mod atomic_file;
mod catalogue;
mod session;
mod todo;
mod todo_write;

const ID_A: &str = "b0cb4064-d525-4edf-ad56-bc5a78832039";
const ID_B: &str = "760893da-3602-40cf-8fee-593e3a80ae85";

fn workspace_json(id: &str, name: &str, path: &str) -> String {
    format!(
        r#"{{"id":"{id}","name":"{name}","color":"blue","todo_path":"{path}","created_at":"2026-10-18T09:11:29.136Z","extra":1}}"#
    )
}

/// A fresh, empty directory for one test.
fn temp_dir(name: &str) -> std::path::PathBuf {
    let dir = std::env::temp_dir().join(format!("tuxedo-core-{name}-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&dir).unwrap();
    dir
}
