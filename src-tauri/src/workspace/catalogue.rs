use atomicwrites::{AtomicFile, OverwriteBehavior};
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::io::Write;
use std::path::PathBuf;

const WORKSPACE_CATALOGUE_VERSION: u32 = 1;
pub(super) const WORKSPACE_COLORS: [&str; 8] = [
    "blue", "green", "amber", "red", "violet", "pink", "cyan", "orange",
];

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
pub(super) struct Workspace {
    id: String,
    name: String,
    color: String,
    todo_path: String,
    created_at: String,
}

impl Workspace {
    pub(super) fn new(name: String, color: String, todo_path: String) -> Self {
        Self {
            id: uuid::Uuid::new_v4().to_string(),
            name,
            color,
            todo_path,
            created_at: chrono::Utc::now().to_rfc3339(),
        }
    }

    #[cfg(test)]
    pub(super) fn fixture(id: &str, name: &str, todo_path: &str) -> Self {
        Self {
            id: id.into(),
            name: name.into(),
            color: "blue".into(),
            todo_path: todo_path.into(),
            created_at: "2026-01-01T00:00:00+00:00".into(),
        }
    }

    pub(super) fn id(&self) -> &str {
        &self.id
    }

    pub(super) fn todo_path(&self) -> &str {
        &self.todo_path
    }
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
pub(crate) struct WorkspaceCatalogue {
    version: u32,
    active_workspace_id: Option<String>,
    workspaces: Vec<Workspace>,
}

impl Default for WorkspaceCatalogue {
    fn default() -> Self {
        Self {
            version: WORKSPACE_CATALOGUE_VERSION,
            active_workspace_id: None,
            workspaces: Vec::new(),
        }
    }
}

impl WorkspaceCatalogue {
    pub(super) fn active_workspace(&self) -> Option<&Workspace> {
        let active_id = self.active_workspace_id.as_deref()?;
        self.workspaces
            .iter()
            .find(|workspace| workspace.id == active_id)
    }

    pub(super) fn workspace(&self, workspace_id: &str) -> Option<&Workspace> {
        self.workspaces
            .iter()
            .find(|workspace| workspace.id == workspace_id)
    }

    pub(super) fn add(&mut self, workspace: Workspace) -> Result<(), CatalogueError> {
        if self
            .workspaces
            .iter()
            .any(|saved| saved.name.eq_ignore_ascii_case(&workspace.name))
        {
            return Err(CatalogueError::Invalid(format!(
                "duplicate workspace name: {}",
                workspace.name
            )));
        }
        if self
            .workspaces
            .iter()
            .any(|saved| saved.todo_path == workspace.todo_path)
        {
            return Err(CatalogueError::Invalid(format!(
                "duplicate todo file: {}",
                workspace.todo_path
            )));
        }
        self.active_workspace_id = Some(workspace.id.clone());
        self.workspaces.push(workspace);
        Ok(())
    }

    pub(super) fn activate(&mut self, workspace_id: &str) -> Result<(), CatalogueError> {
        if self.workspace(workspace_id).is_none() {
            return Err(CatalogueError::Invalid(format!(
                "workspace does not exist: {workspace_id}"
            )));
        }
        self.active_workspace_id = Some(workspace_id.to_owned());
        Ok(())
    }

    pub(super) fn remove(&mut self, workspace_id: &str) -> bool {
        let Some(index) = self
            .workspaces
            .iter()
            .position(|workspace| workspace.id == workspace_id)
        else {
            return false;
        };
        self.workspaces.remove(index);
        if self.active_workspace_id.as_deref() == Some(workspace_id) {
            self.active_workspace_id = None;
        }
        true
    }
}

pub(super) struct WorkspaceCatalogueStore {
    path: PathBuf,
}

impl WorkspaceCatalogueStore {
    pub(super) fn new(path: PathBuf) -> Self {
        Self { path }
    }

    pub(super) fn load(&self) -> Result<WorkspaceCatalogue, CatalogueError> {
        if !self.path.exists() {
            return Ok(WorkspaceCatalogue::default());
        }
        let contents = std::fs::read_to_string(&self.path)?;
        let catalogue: WorkspaceCatalogue = toml::from_str(&contents)?;
        validate_catalogue(&catalogue)?;
        Ok(catalogue)
    }

    pub(super) fn save(&self, catalogue: &WorkspaceCatalogue) -> Result<(), CatalogueError> {
        validate_catalogue(catalogue)?;
        if let Some(parent) = self.path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let contents = toml::to_string(catalogue)?;
        let atomic_file = AtomicFile::new(&self.path, OverwriteBehavior::AllowOverwrite);
        atomic_file.write(|file| file.write_all(contents.as_bytes()))?;
        Ok(())
    }
}

fn validate_catalogue(catalogue: &WorkspaceCatalogue) -> Result<(), CatalogueError> {
    if catalogue.version != WORKSPACE_CATALOGUE_VERSION {
        return Err(CatalogueError::Invalid(format!(
            "unsupported workspace catalogue version: {}",
            catalogue.version
        )));
    }

    let mut names = HashSet::new();
    let mut paths = HashSet::new();
    let mut ids = HashSet::new();
    for workspace in &catalogue.workspaces {
        if workspace.name.is_empty() || workspace.name != workspace.name.trim() {
            return Err(CatalogueError::Invalid(
                "workspace name must be trimmed and non-empty".into(),
            ));
        }
        uuid::Uuid::parse_str(&workspace.id).map_err(|_| {
            CatalogueError::Invalid(format!("invalid workspace id: {}", workspace.id))
        })?;
        chrono::DateTime::parse_from_rfc3339(&workspace.created_at).map_err(|_| {
            CatalogueError::Invalid(format!(
                "invalid workspace creation timestamp: {}",
                workspace.created_at
            ))
        })?;
        if workspace.todo_path.trim().is_empty() {
            return Err(CatalogueError::Invalid(
                "workspace todo file path must not be empty".into(),
            ));
        }
        if !WORKSPACE_COLORS.contains(&workspace.color.as_str()) {
            return Err(CatalogueError::Invalid(format!(
                "unsupported workspace color: {}",
                workspace.color
            )));
        }
        if !ids.insert(&workspace.id) {
            return Err(CatalogueError::Invalid(format!(
                "duplicate workspace id: {}",
                workspace.id
            )));
        }
        if !names.insert(workspace.name.to_lowercase()) {
            return Err(CatalogueError::Invalid(format!(
                "duplicate workspace name: {}",
                workspace.name
            )));
        }
        if !paths.insert(&workspace.todo_path) {
            return Err(CatalogueError::Invalid(format!(
                "duplicate todo file: {}",
                workspace.todo_path
            )));
        }
    }
    if let Some(active_id) = &catalogue.active_workspace_id {
        if !ids.contains(active_id) {
            return Err(CatalogueError::Invalid(format!(
                "active workspace does not exist: {active_id}"
            )));
        }
    }
    Ok(())
}

#[derive(Debug, thiserror::Error)]
pub(super) enum CatalogueError {
    #[error("failed to read or write workspace catalogue: {0}")]
    Io(#[from] std::io::Error),
    #[error("failed to parse workspace catalogue: {0}")]
    TomlDeserialize(#[from] toml::de::Error),
    #[error("failed to serialize workspace catalogue: {0}")]
    TomlSerialize(#[from] toml::ser::Error),
    #[error("failed to write workspace catalogue atomically: {0}")]
    AtomicWrite(#[from] atomicwrites::Error<std::io::Error>),
    #[error("invalid workspace catalogue: {0}")]
    Invalid(String),
}

#[cfg(test)]
mod tests;
