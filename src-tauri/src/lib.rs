mod todo_txt;
mod workspace;

use std::path::PathBuf;
use todo_txt::error::LoadError;
use todo_txt::types::TodoFile;

#[tauri::command]
fn parse_todo_file(path: String) -> Result<TodoFile, String> {
    load_todo_file(path).map_err(|error| error.to_string())
}

pub(crate) fn load_todo_file(path: String) -> Result<TodoFile, LoadError> {
    let path_buf = PathBuf::from(&path);

    if !path_buf.exists() {
        return Err(LoadError::MissingPath(path));
    }

    if !path_buf.is_file() {
        return Err(LoadError::NotAFile(path));
    }

    let contents = std::fs::read_to_string(&path_buf)?;
    let (items, skipped) = todo_txt::parser::parse_file(&contents);

    Ok(TodoFile {
        path,
        items,
        skipped,
    })
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            parse_todo_file,
            workspace::restore_workspace_session,
            workspace::switch_workspace,
            workspace::delete_workspace,
            workspace::create_workspace,
            workspace::set_todo_item_completion
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
