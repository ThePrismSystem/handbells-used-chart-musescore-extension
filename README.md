# Handbells Used Chart

Generates a "Handbells Used" / "Handchimes Used" chart for MuseScore 4.7
handbell scores — the grand-staff block of noteheads publishers print between
the title and the first system, listing every bell and chime the piece requires.

## Status

Under development. The command-line tool comes first; the MuseScore plugin
follows.

## Usage

    npm run chart -- input.mscz output.mscz

## Testing

    npm test

## License

GPL-3.0-only. The note-reading logic is adapted from the
[handbell-notation](https://github.com/andylyttle/handbell-notation) plugins,
copyright 2025 Andy Lyttle, used under the GPL-3.0.
