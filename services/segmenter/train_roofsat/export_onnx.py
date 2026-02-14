import argparse
import os


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("--checkpoint", required=True, help="Path to best.pt or last.pt")
    p.add_argument("--out", required=True, help="Output .onnx path")
    p.add_argument("--opset", type=int, default=17)
    args = p.parse_args()

    try:
        import torch  # type: ignore
    except Exception as e:
        raise RuntimeError(f"PyTorch required: {e}")

    try:
        import segmentation_models_pytorch as smp  # type: ignore
    except Exception as e:
        raise RuntimeError(f"segmentation-models-pytorch required: {e}")

    ckpt = torch.load(args.checkpoint, map_location="cpu")
    encoder = ckpt.get("encoder") or "resnet34"
    size = int(ckpt.get("input_size") or 512)

    model = smp.Unet(
        encoder_name=str(encoder),
        encoder_weights=None,
        in_channels=3,
        classes=1,
        activation=None,
    )
    model.load_state_dict(ckpt["model_state"], strict=True)
    model.eval()

    dummy = torch.randn(1, 3, size, size, dtype=torch.float32)

    out_path = os.path.abspath(args.out)
    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    torch.onnx.export(
        model,
        dummy,
        out_path,
        export_params=True,
        opset_version=int(args.opset),
        do_constant_folding=True,
        input_names=["image"],
        output_names=["logits"],
    )
    print(out_path)


if __name__ == "__main__":
    main()
