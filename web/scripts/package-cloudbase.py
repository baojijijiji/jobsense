"""Package the prepared HTTP function, preserving Linux bootstrap permissions."""
import json
import stat
import zipfile
from pathlib import Path

web_root = Path(__file__).resolve().parent.parent
runtime = web_root / '.cloudbase-build' / 'functions' / 'jobsense'
runtime_resolved = runtime.resolve()
runtime_resolved.relative_to(web_root)
required = {'index.js', 'package.json', 'scf_bootstrap', 'public/index.html',
            'server/cloudbaseIndex.js', 'server/cloudbaseServer.js', 'server/hostedGateway.js', 'server/resumeAi.js'}
files = []
for path in sorted(runtime.rglob('*')):
    if path.is_symlink():
        raise ValueError('Runtime package cannot contain symlinks')
    if not path.is_file():
        continue
    path.resolve().relative_to(runtime_resolved)
    name = path.relative_to(runtime).as_posix()
    if name not in required and not name.startswith('public/'):
        raise ValueError('Unexpected runtime file')
    if any(part.startswith('.') for part in path.relative_to(runtime).parts) or path.suffix in {'.local', '.log', '.ts'}:
        raise ValueError('Private or source-only file found in runtime package')
    files.append((path, name))
if not required.issubset({name for _, name in files}):
    raise ValueError('Build the CloudBase runtime before packaging')
bootstrap = (runtime / 'scf_bootstrap').read_bytes()
if not bootstrap.startswith(b'#!/bin/bash\n') or b'\r' in bootstrap:
    raise ValueError('Bootstrap must use LF newlines')
if json.loads((runtime / 'package.json').read_text()).get('dependencies'):
    raise ValueError('Runtime unexpectedly requires npm dependencies')

release_root = web_root.parent / '发布包'
release_root.mkdir(exist_ok=True)
archive_path = release_root / 'JobSense-CloudBase发布包.zip'
with zipfile.ZipFile(archive_path, 'w', zipfile.ZIP_DEFLATED) as archive:
    for path, name in files:
        entry = zipfile.ZipInfo(name)
        entry.create_system = 3
        entry.external_attr = (stat.S_IFREG | (0o755 if name == 'scf_bootstrap' else 0o644)) << 16
        entry.compress_type = zipfile.ZIP_DEFLATED
        archive.writestr(entry, path.read_bytes())
with zipfile.ZipFile(archive_path) as archive:
    if archive.testzip() is not None or stat.S_IMODE(archive.getinfo('scf_bootstrap').external_attr >> 16) != 0o755:
        raise ValueError('Runtime archive verification failed')
print(f'CloudBase package ready: {len(files)} files, bootstrap permission 0755, no local credentials.')
print(archive_path)
