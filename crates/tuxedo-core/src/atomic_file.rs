//! Atomic file replacement shared by Todo-file and catalogue writes, matching
//! `packages/backend/src/atomic-write.ts` plus a parent-directory sync after the rename.

use std::fs::{self, File, OpenOptions};
use std::io::{self, Write};
use std::path::{Path, PathBuf};

use crate::CoreError;

/// Replaces `path` with `contents` through an adjacent `.tuxedo-<UUID>.tmp` file.
///
/// Creates missing parent directories. The temporary file is created exclusively at `0600`,
/// written, given `mode` (Unix permission bits; ignored elsewhere), synced, closed, and renamed
/// over `path`. Any failure before the rename leaves `path` unchanged and removes only the
/// temporary file this call created. A failure to sync the parent directory after the rename is
/// [`CoreError::WriteUnconfirmed`]: the new contents may or may not be durable, so the caller must
/// reread the file before accepting anything and must not retry automatically.
pub(crate) fn atomic_replace(path: &Path, contents: &[u8], mode: u32) -> Result<(), CoreError> {
    let directory = match path.parent() {
        Some(parent) if !parent.as_os_str().is_empty() => parent.to_path_buf(),
        _ => PathBuf::from("."),
    };
    fs::create_dir_all(&directory).map_err(io_error(&directory))?;

    let temporary = directory.join(format!(".tuxedo-{}.tmp", uuid::Uuid::new_v4()));
    let file = create_exclusive(&temporary).map_err(io_error(&temporary))?;
    // From here on the temporary file is ours; remove it on any pre-rename failure.
    let written = write_and_sync(file, &temporary, contents, mode)
        .and_then(|()| fs::rename(&temporary, path).map_err(io_error(path)));
    if let Err(error) = written {
        let _ = fs::remove_file(&temporary);
        return Err(error);
    }

    sync_directory(&directory).map_err(|source| CoreError::WriteUnconfirmed {
        path: path.to_path_buf(),
        source,
    })
}

fn io_error(path: &Path) -> impl FnOnce(io::Error) -> CoreError + '_ {
    move |source| CoreError::Io {
        path: path.to_path_buf(),
        source,
    }
}

fn create_exclusive(path: &Path) -> io::Result<File> {
    let mut options = OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    std::os::unix::fs::OpenOptionsExt::mode(&mut options, 0o600);
    options.open(path)
}

fn write_and_sync(
    mut file: File,
    path: &Path,
    contents: &[u8],
    mode: u32,
) -> Result<(), CoreError> {
    file.write_all(contents).map_err(io_error(path))?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        file.set_permissions(fs::Permissions::from_mode(mode))
            .map_err(io_error(path))?;
    }
    #[cfg(not(unix))]
    let _ = mode;
    file.sync_all().map_err(io_error(path))
    // `file` closes here, before the rename.
}

#[cfg(unix)]
fn sync_directory(directory: &Path) -> io::Result<()> {
    File::open(directory)?.sync_all()
}

#[cfg(not(unix))]
fn sync_directory(_directory: &Path) -> io::Result<()> {
    // Directories cannot be opened for syncing on Windows; the rename itself is the commit.
    Ok(())
}
