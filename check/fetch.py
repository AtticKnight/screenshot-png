from pathlib import Path, PurePosixPath
from tarfile import open as open_tar
from urllib.request import Request, urlopen
from shutil import copyfileobj

url = 'https://make.fun/c/png-squeeze-01-run-20261127/kit'
target = Path('check/kit')
target.mkdir(exist_ok=True)
request = Request(url, headers={'User-Agent': 'AtticKnight public prize benchmark'})
with urlopen(request, timeout=60) as response, open_tar(fileobj=response, mode='r|gz') as archive:
    for member in archive:
        parts = PurePosixPath(member.name).parts
        if not member.isfile() or len(parts) < 2 or '..' in parts or parts[0].startswith('/'):
            continue
        name = '/'.join(parts[1:])
        if not name.startswith(('practice/', 'program/scorer/checker/', 'baselines/fixed-paeth/', 'program/generator/subject/scale.mjs')):
            continue
        destination = target / name
        destination.parent.mkdir(parents=True, exist_ok=True)
        with destination.open('wb') as out:
            copyfileobj(archive.extractfile(member), out)
