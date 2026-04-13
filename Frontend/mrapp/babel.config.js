module.exports = function (api) {
  api.cache(true);
  return {
    presets: [["babel-preset-expo", { jsxImportSource: "nativewind" }]],
    plugins: [
      // Disabled: react-native-reanimated/plugin was requiring react-native-worklets
      // which we removed. Reanimated still works without this plugin.
      // "react-native-reanimated/plugin"
    ],
  };
};
