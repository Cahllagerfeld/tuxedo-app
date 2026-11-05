//! Unit tests, one module per topic. Shared fixtures live here.

mod catalogue;
mod session;
mod todo;

const ID_A: &str = "b0cb4064-d525-4edf-ad56-bc5a78832039";
const ID_B: &str = "760893da-3602-40cf-8fee-593e3a80ae85";

fn workspace_json(id: &str, name: &str, path: &str) -> String {
    format!(
        r#"{{"id":"{id}","name":"{name}","color":"blue","todo_path":"{path}","created_at":"2026-10-18T09:11:29.136Z","extra":1}}"#
    )
}
