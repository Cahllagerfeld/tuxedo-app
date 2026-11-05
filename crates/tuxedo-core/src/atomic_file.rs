//! Atomic file replacement shared by Todo-file and catalogue writes, matching
//! `packages/backend/src/atomic-write.ts` plus a parent-directory sync after the rename.
//! `tempfile` owns the exclusive adjacent temporary file and removes it (and only it) if the
//! replacement fails before the rename, including on panic.

use std::fs::{self, File};
use std::io::{self, Write};
use std::path::{Path, PathBuf};

use crate::CoreError;

/// Replaces `path` with `contents` through an adjacent `.tuxedo-*.tmp` file.
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

    let mut temporary = tempfile::Builder::new()
        .prefix(".tuxedo-")
        .suffix(".tmp")
        .tempfile_in(&directory)
        .map_err(io_error(&directory))?;
    let temporary_path = temporary.path().to_path_buf();
    temporary
        .write_all(contents)
        .and_then(|()| set_mode(temporary.as_file(), mode))
        .and_then(|()| temporary.as_file().sync_all())
        .map_err(io_error(&temporary_path))?;
    // Close before renaming; a failed rename drops the path, which removes our file.
    temporary
        .into_temp_path()
        .persist(path)
        .map_err(|error| CoreError::Io {
            path: path.to_path_buf(),
            source: error.error,
        })?;

    #[cfg(any(test, all(feature = "fault-injection", debug_assertions)))]
    let synced = fault::check(&directory).and_then(|()| sync_directory(&directory));
    #[cfg(not(any(test, all(feature = "fault-injection", debug_assertions))))]
    let synced = sync_directory(&directory);
    synced.map_err(|source| CoreError::WriteUnconfirmed {
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

#[cfg(unix)]
fn set_mode(file: &File, mode: u32) -> io::Result<()> {
    use std::os::unix::fs::PermissionsExt;
    file.set_permissions(fs::Permissions::from_mode(mode))
}

#[cfg(not(unix))]
fn set_mode(_file: &File, _mode: u32) -> io::Result<()> {
    Ok(())
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

/// Test-only fault injection: fails the parent-directory sync after the rename.
#[cfg(any(test, all(feature = "fault-injection", debug_assertions)))]
pub(crate) mod fault {
    use std::io;
    use std::path::{Path, PathBuf};
    use std::sync::Mutex;

    static FAILING: Mutex<Vec<PathBuf>> = Mutex::new(Vec::new());

    /// Makes every later atomic replacement in `directory` fail its directory sync, after the
    /// rename has already replaced the file.
    pub fn fail_directory_sync(directory: &Path) {
        FAILING.lock().unwrap().push(directory.to_path_buf());
    }

    pub(super) fn check(directory: &Path) -> io::Result<()> {
        if FAILING.lock().unwrap().iter().any(|d| d == directory) {
            return Err(io::Error::other("injected directory sync failure"));
        }
        Ok(())
    }
}
