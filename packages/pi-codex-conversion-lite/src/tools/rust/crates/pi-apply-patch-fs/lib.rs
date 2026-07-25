//! Local-only filesystem adapter for the vendored Codex apply-patch crate.
//!
//! Upstream routes this contract through Codex's exec-server and sandbox stack.
//! Pi applies patches on the host, so this crate keeps only the operations the
//! patch engine uses and rejects sandbox contexts explicitly.

use async_trait::async_trait;
use codex_utils_path_uri::PathUri;
use std::io;
use std::sync::{Arc, LazyLock};

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct CreateDirectoryOptions {
    pub recursive: bool,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct RemoveOptions {
    pub recursive: bool,
    pub force: bool,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct FileMetadata {
    pub is_directory: bool,
    pub is_file: bool,
    pub is_symlink: bool,
    pub size: u64,
    pub created_at_ms: i64,
    pub modified_at_ms: i64,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct FileSystemSandboxContext;

#[async_trait]
pub trait ExecutorFileSystem: Send + Sync {
    async fn read_file(
        &self,
        path: &PathUri,
        sandbox: Option<&FileSystemSandboxContext>,
    ) -> io::Result<Vec<u8>>;
    async fn read_file_text(
        &self,
        path: &PathUri,
        sandbox: Option<&FileSystemSandboxContext>,
    ) -> io::Result<String> {
        let bytes = self.read_file(path, sandbox).await?;
        String::from_utf8(bytes).map_err(|err| io::Error::new(io::ErrorKind::InvalidData, err))
    }
    async fn write_file(
        &self,
        path: &PathUri,
        contents: Vec<u8>,
        sandbox: Option<&FileSystemSandboxContext>,
    ) -> io::Result<()>;
    async fn create_directory(
        &self,
        path: &PathUri,
        options: CreateDirectoryOptions,
        sandbox: Option<&FileSystemSandboxContext>,
    ) -> io::Result<()>;
    async fn get_metadata(
        &self,
        path: &PathUri,
        sandbox: Option<&FileSystemSandboxContext>,
    ) -> io::Result<FileMetadata>;
    async fn remove(
        &self,
        path: &PathUri,
        options: RemoveOptions,
        sandbox: Option<&FileSystemSandboxContext>,
    ) -> io::Result<()>;
}

pub static LOCAL_FS: LazyLock<Arc<dyn ExecutorFileSystem>> =
    LazyLock::new(|| Arc::new(LocalFileSystem));
struct LocalFileSystem;

fn local_path(
    path: &PathUri,
    sandbox: Option<&FileSystemSandboxContext>,
) -> io::Result<std::path::PathBuf> {
    if sandbox.is_some() {
        return Err(io::Error::new(
            io::ErrorKind::Unsupported,
            "sandboxed filesystem is not available in bundled apply_patch",
        ));
    }
    Ok(path.to_abs_path()?.into_path_buf())
}

fn metadata_to_file_metadata(metadata: std::fs::Metadata) -> FileMetadata {
    FileMetadata {
        is_directory: metadata.is_dir(),
        is_file: metadata.is_file(),
        is_symlink: metadata.file_type().is_symlink(),
        size: metadata.len(),
        created_at_ms: metadata
            .created()
            .ok()
            .and_then(|time| time.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|duration| duration.as_millis() as i64)
            .unwrap_or(0),
        modified_at_ms: metadata
            .modified()
            .ok()
            .and_then(|time| time.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|duration| duration.as_millis() as i64)
            .unwrap_or(0),
    }
}

#[async_trait]
impl ExecutorFileSystem for LocalFileSystem {
    async fn read_file(
        &self,
        path: &PathUri,
        sandbox: Option<&FileSystemSandboxContext>,
    ) -> io::Result<Vec<u8>> {
        std::fs::read(local_path(path, sandbox)?)
    }
    async fn write_file(
        &self,
        path: &PathUri,
        contents: Vec<u8>,
        sandbox: Option<&FileSystemSandboxContext>,
    ) -> io::Result<()> {
        std::fs::write(local_path(path, sandbox)?, contents)
    }
    async fn create_directory(
        &self,
        path: &PathUri,
        options: CreateDirectoryOptions,
        sandbox: Option<&FileSystemSandboxContext>,
    ) -> io::Result<()> {
        let path = local_path(path, sandbox)?;
        if options.recursive {
            std::fs::create_dir_all(path)
        } else {
            std::fs::create_dir(path)
        }
    }
    async fn get_metadata(
        &self,
        path: &PathUri,
        sandbox: Option<&FileSystemSandboxContext>,
    ) -> io::Result<FileMetadata> {
        std::fs::symlink_metadata(local_path(path, sandbox)?).map(metadata_to_file_metadata)
    }
    async fn remove(
        &self,
        path: &PathUri,
        options: RemoveOptions,
        sandbox: Option<&FileSystemSandboxContext>,
    ) -> io::Result<()> {
        let path = local_path(path, sandbox)?;
        let metadata = match std::fs::symlink_metadata(&path) {
            Ok(metadata) => metadata,
            Err(error) if options.force && error.kind() == io::ErrorKind::NotFound => return Ok(()),
            Err(error) => return Err(error),
        };
        if metadata.is_dir() {
            if options.recursive {
                std::fs::remove_dir_all(path)
            } else {
                std::fs::remove_dir(path)
            }
        } else {
            std::fs::remove_file(path)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn local_filesystem_reads_host_path_uris() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("file.txt");
        std::fs::write(&path, "hello").unwrap();
        let uri = PathUri::from_host_native_path(&path).unwrap();

        assert_eq!(LOCAL_FS.read_file_text(&uri, None).await.unwrap(), "hello");
    }

    #[tokio::test]
    async fn local_filesystem_rejects_sandbox_contexts() {
        let dir = tempfile::tempdir().unwrap();
        let uri = PathUri::from_host_native_path(dir.path().join("file.txt")).unwrap();
        let error = LOCAL_FS
            .write_file(&uri, b"hello".to_vec(), Some(&FileSystemSandboxContext))
            .await
            .unwrap_err();

        assert_eq!(error.kind(), io::ErrorKind::Unsupported);
    }
}
