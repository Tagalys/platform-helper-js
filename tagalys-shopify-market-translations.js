var TagalysMarketTranslations = {
  translate: async (response, staticTranslations = {}) => {
    var tagalysConfiguration = Tagalys.getConfiguration()
    var useMarketForProductDetails = (tagalysConfiguration.baseCountryCode !== tagalysConfiguration.countryCode)
    if (!useMarketForProductDetails) {
      return response
    }

    if (response.products) {
      var productDetailsFromMarket = await TagalysMarketTranslations.fetchMarketDetails(response.products)
      // Filter out products that are not available in the market
      response.products = response.products.filter((product) => productDetailsFromMarket[product.id])
      response.products.forEach((product) => {
        TagalysMarketTranslations.formatProduct(product, productDetailsFromMarket[product.id])
       })
    }
    if (response.filters) {
      TagalysMarketTranslations.formatFilters(response.filters, staticTranslations)
    }
    return response
  },
  fetchMarketDetails: async (products) => {
    var productNodeIds = products.map(
      (product) => `gid://shopify/Product/${product.id}`
    );
    if (!productNodeIds.length) return {}

    var tagalysConfiguration = Tagalys.getConfiguration()
    var metafieldsToInclude = TagalysMarketTranslations.getRequiredMetafields(products)

    var identifiers = metafieldsToInclude.map((metafieldToInclude) => `{namespace: "${metafieldToInclude.namespace}", key: "${metafieldToInclude.key}"}`)

    var platformVariables = tagalysConfiguration.platformVariables

    var response = await fetch(`https://${platformVariables.myShopifyDomain}/api/2024-04/graphql.json`, {
      body: `
      query allProducts @inContext(country: ${tagalysConfiguration.countryCode}, language: ${tagalysConfiguration.language}) {
        nodes(ids: ${JSON.stringify(productNodeIds)})
        {
          ... on Product{
            id
            title
            handle
            options{
              id
              name
              values
            }
            metafields(identifiers: [${identifiers}]){
              id
              key
              namespace
              type
              value
            }
            variants(first: 250){
              edges{
                node{
                  id
                  title
                  selectedOptions{
                    name
                    value
                  }
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
        "X-Shopify-Storefront-Access-Token": platformVariables.storeFrontAPIAccessToken,
      },
      method: "POST",
    });

    var responseJson = await response.json();
    var productDetailsMap = {};

    responseJson.data.nodes.forEach((product) => {
      if (product) {
        var productId = product.id.split("/").pop();
        var productVariants = product.variants.edges;

        var variantCompareAtPrices = productVariants.map((productVariant) => {
          var price = parseFloat(productVariant.node.price.amount);
          if (productVariant.node.compareAtPrice) {
            var compareAtPrice = parseFloat(
              productVariant.node.compareAtPrice.amount
            );
            if (compareAtPrice > price) {
              return compareAtPrice;
            }
          }
          return price;
        });

        var prices = productVariants.map((productVariant) =>
          parseFloat(productVariant.node.price.amount)
        );

        var price = prices.length > 0 ? Math.min(...prices) : null;
        var compareAtPrice =
          variantCompareAtPrices.length > 0
            ? Math.min(...variantCompareAtPrices)
            : null;

        if (compareAtPrice !== null && price !== null) {
          compareAtPrice = Math.max(...[price, compareAtPrice]);
        }

        productDetailsMap[productId] = {
          title: product.title,
          handle: product.handle,
          options: product.options,
          compareAtPrice:
            compareAtPrice !== null
              ? TagalysMarketTranslations.applyCurrencyConversion(compareAtPrice)
              : null,
          price: price !== null ? TagalysMarketTranslations.applyCurrencyConversion(price) : null,
          variants: productVariants.map((variant) => {
            return {
              id: parseInt(variant.node.id.split("/").pop()),
              title: variant.node.title,
              price: TagalysMarketTranslations.applyCurrencyConversion(parseFloat(variant.node.price.amount)),
              compareAtPrice: variant.node.compareAtPrice ?
                TagalysMarketTranslations.applyCurrencyConversion(parseFloat(variant.node.compareAtPrice.amount)) :
                null,
              selectedOptions: variant.node.selectedOptions,
            }
          }),
          metafields: product.metafields
        };
      }
    });
    return productDetailsMap;
  },
  formatProduct: (product, productDetailsFromMarket) => {
    product.title = productDetailsFromMarket.title
    product.handle = productDetailsFromMarket.handle
    product.price = productDetailsFromMarket.price
    product.compare_at_price = productDetailsFromMarket.compareAtPrice
    product.options = productDetailsFromMarket.options.map((option) => option.name)
    product.options_with_values.forEach((optionWithValue) => {
      var optionDetailsFromMarket = productDetailsFromMarket.options.find((option) =>{
        return (option.id.split("/").pop() === optionWithValue.id)
      })
      if(optionDetailsFromMarket){
        optionWithValue.name = optionDetailsFromMarket.name
        optionWithValue.values = optionDetailsFromMarket.values
      }
    })
    product.variants.forEach((variant) => {
      var variantDetailFromMarket = productDetailsFromMarket.variants.find((variantFromMarket) => variantFromMarket.id === variant.id)
      TagalysMarketTranslations.formatVariantDetails(variant, variantDetailFromMarket)
    })
    Object.keys(product.metafields).forEach((namespace) => {
      Object.keys(product.metafields[namespace]).forEach((key) => {
        var metafieldDetailFromMarket = productDetailsFromMarket.metafields.find((metafield) => {
          return (metafield && metafield.namespace === namespace && metafield.key === key)
        })
        if (metafieldDetailFromMarket) {
          var metafieldValueFromMarket = metafieldDetailFromMarket.value

          product.metafields[namespace][key]["value"] = metafieldValueFromMarket
          if (metafieldDetailFromMarket.type === "single_line_text_field") {
            product.metafields[namespace][key]["value"] = [metafieldValueFromMarket]
          }
          if (metafieldDetailFromMarket.type === "list.single_line_text_field") {
            product.metafields[namespace][key]["value"] = JSON.parse(metafieldValueFromMarket)
          }
        }
      })
    })
  },
  formatVariantDetails: (variant, variantDetailFromMarket) => {
    variant.title = variantDetailFromMarket.title
    variant.price = variantDetailFromMarket.price
    variant.compare_at_price = variantDetailFromMarket.compareAtPrice
    variant.option1 = variantDetailFromMarket.selectedOptions[0] ? variantDetailFromMarket.selectedOptions[0].value : null
    variant.option2 = variantDetailFromMarket.selectedOptions[1] ? variantDetailFromMarket.selectedOptions[1].value : null
    variant.option3 = variantDetailFromMarket.selectedOptions[2] ? variantDetailFromMarket.selectedOptions[2].value : null
  },
  formatFilters: (filters, staticTranslations) => {
    var configuration = Tagalys.getConfiguration()
    var translationKey = `${configuration.language}-${configuration.countryCode}`
    filters.forEach((filter) => {
      var isTranslationRequired = (
        staticTranslations.hasOwnProperty(translationKey) &&
        staticTranslations[translationKey].hasOwnProperty("filters") &&
        staticTranslations[translationKey].filters.hasOwnProperty(filter.id)
      )
      if (isTranslationRequired) {
        var thisFilterTranslation = staticTranslations[translationKey]["filters"][filter.id]
        if(thisFilterTranslation.hasOwnProperty("title")){
          filter.name = thisFilterTranslation.title
        }
        if(thisFilterTranslation.hasOwnProperty("options")){
          filter.items.forEach((filterValue) => {
            if (thisFilterTranslation.options.hasOwnProperty(filterValue.name)) {
              filterValue.name = thisFilterTranslation.options[filterValue.name]
            }
          })
        }
      }
    })
  },
  getRequiredMetafields: (products) => {
    var metafieldDetails = {}
    products.forEach((product) => {
      Object.keys(product.metafields).forEach((namespace) => {
        Object.keys(product.metafields[namespace]).forEach((key) => {
          metafieldDetails[namespace] ||= []
          var isKeyAlreadyAdded = metafieldDetails[namespace].find((existingKey) => existingKey === key)
          if (!isKeyAlreadyAdded) {
            metafieldDetails[namespace].push(key)
          }
        })
      })
    })
    var requiredMetafields = []
    Object.entries(metafieldDetails).forEach(([namespace, keys]) => {
      keys.map((key) => {
        requiredMetafields.push({
          key: key,
          namespace: namespace
        })
      })
    })
    return requiredMetafields
  },
  applyCurrencyConversion: (number) => {
    const configuration = Tagalys.getConfiguration();
    const fractionalDigits = configuration.currency.fractionalDigits
    const convertedNumber = Math.round(number * Math.pow(10, fractionalDigits)) / Math.pow(10, fractionalDigits);
    return convertedNumber;
  }
}