var TagalysPlatformHelpers = {
  getProductPrices: async function (productIds, countryCode, { myShopifyDomain, storeFrontAPIAccessToken, applyCurrencyConversion }) {
    if (!productIds.length) return {}

    var productNodeIds = productIds.map(
      (productId) => `gid://shopify/Product/${productId}`
    );
    var response = await fetch(`https://${myShopifyDomain}/api/2023-07/graphql.json`, {
      body: `
      query allProducts @inContext(country: ${countryCode}) {
        nodes(ids: ${JSON.stringify(productNodeIds)})
        {
          ... on Product{
            id
            variants(first: 250){
              edges{
                node{
                  id
                  price {
                    amount
                  }
                  compareAtPrice{
                    amount
                  }
                }
              }
            }
          }
        }
      }
      `,
      headers: {
        "Content-Type": "application/graphql",
        "X-Shopify-Storefront-Access-Token": storeFrontAPIAccessToken,
      },
      method: "POST",
    });
    var responseJson = await response.json();
    var products = responseJson.data.nodes;
    var productToPriceMap = {};

    products.forEach((product) => {
      if (product) {
        var productId = product.id.split("/").pop();
        var productVariants = product.variants.edges;
        var variantPrices = {}

        var variantCompareAtPrices = productVariants.filter((productVariant) => productVariant.node.compareAtPrice).map((productVariant) => parseFloat(productVariant.node.compareAtPrice.amount));
        var prices = productVariants.map((productVariant) =>
          parseFloat(productVariant.node.price.amount)
        );

        var price = prices.length > 0 ? Math.min(...prices) : null;
        var compareAtPrice =
          variantCompareAtPrices.length > 0
            ? Math.min(...variantCompareAtPrices)
            : null;

        // constructing variant prices
        productVariants.forEach((productVariant) => {
          var variantId = productVariant.node.id.split("/").pop();
          var variantPrice = parseFloat(productVariant.node.price.amount)
          var variantCompareAtPrice = productVariant.node.compareAtPrice ? parseFloat(productVariant.node.compareAtPrice.amount) : null
          variantPrices[variantId] = {
            price: variantPrice,
            compareAtPrice: variantCompareAtPrice
          }
        })

        productToPriceMap[productId] = {
          compareAtPrice:
            compareAtPrice !== null
              ? applyCurrencyConversion(compareAtPrice)
              : null,
          price: price !== null ? applyCurrencyConversion(price) : null,
          variantPrices: variantPrices
        };
      }
    });

    return productToPriceMap;
  }
};