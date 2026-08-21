import { Image, StyleSheet, View } from "react-native";

import { colors } from "@/constants/theme";

type BrandMarkProps = {
  size?: number;
};

export function BrandMark({ size = 76 }: BrandMarkProps) {
  return (
    <View style={[styles.frame, { width: size, height: size, borderRadius: size * 0.28 }]}>
      <Image
        accessibilityIgnoresInvertColors
        source={require("../../../../public/brand/idobata-logo.png")}
        style={{ width: size * 0.82, height: size * 0.82 }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  frame: {
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    shadowColor: colors.brand,
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.24,
    shadowRadius: 20,
  },
});
