use std::path::{Path, PathBuf};

use crate::CoreError;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Workspace {
    pub id: String,
    pub name: String,
    pub todo_file: PathBuf,
    pub color: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct Catalogue {
    pub workspaces: Vec<Workspace>,
    pub active_workspace_id: Option<String>,
}

pub fn default_catalogue_path() -> Option<PathBuf> {
    None
}

pub fn load_catalogue(path: &Path) -> Result<Catalogue, CoreError> {
    let _ = path;
    Ok(Catalogue::default())
}
