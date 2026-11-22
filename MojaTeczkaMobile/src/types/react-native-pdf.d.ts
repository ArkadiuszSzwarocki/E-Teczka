declare module "react-native-pdf" {
  import { ComponentType } from "react";
  import type { StyleProp, ViewStyle } from "react-native";

  type PdfSource = { uri: string; cache?: boolean };
  type PdfProps = {
    source: PdfSource;
    style?: StyleProp<ViewStyle>;
    onLoadComplete?: () => void;
    onError?: (error: Error) => void;
  };

  const Pdf: ComponentType<PdfProps>;
  export default Pdf;
}
