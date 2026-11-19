declare module "bidi-js" {
  const factory: () => {
    getEmbeddingLevels: (s: string, d?: string) => any;
    getReorderedString: (s: string, l: any) => string;
  };
  export default factory;
}
