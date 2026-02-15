## Structurizr diagrams (Sunnyview)

This repo includes a Structurizr DSL workspace at `structurizr/workspace.dsl`.

### Validate the DSL

```bash
bash structurizr/bin/structurizr-cli/structurizr.sh validate -w structurizr/workspace.dsl
```

### Export an interactive static viewer

```bash
mkdir -p structurizr/out
bash structurizr/bin/structurizr-cli/structurizr.sh export -w structurizr/workspace.dsl -f static -o structurizr/out
```

Then open `structurizr/out/index.html` in a browser and use the diagram picker / arrow keys to switch views.

### Export standalone PNG images (for README/GitHub)

1) Export the static viewer (step above)

2) Generate images:

```bash
npm run diagrams:export
```

By default this generates 16:9 PNGs at `1920x1080`. You can override via:

```bash
DIAGRAM_WIDTH=2560 DIAGRAM_HEIGHT=1440 npm run diagrams:export
```

Outputs:

- `structurizr/diagrams/general-architecture.png`
- `structurizr/diagrams/main-feature.png`
