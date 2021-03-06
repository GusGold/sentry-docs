import { Node } from "gatsby";
import { createFilePath } from "gatsby-source-filesystem";

import { getChild, getDataOrPanic } from "../helpers";

type Guide = {
  node: Node;
  children: Node[];
};

type Platform = {
  node: Node;
  children: Node[];
  guides: {
    [name: string]: Guide;
  };
  common: Node[];
};

type PlatformData = {
  platforms: {
    [key: string]: Platform;
  };
  common: Node[];
};

const getPlatfromFromNode = (node: any): string | null => {
  const match = node.relativePath.match(/^([^\/]+)\//);
  return match ? match[1] : null;
};

const getGuideFromNode = (node: any): string | null => {
  const match = node.relativePath.match(/^[^\/]+\/guides\/([^\/]+)\//);
  return match ? match[1] : null;
};

const isCommonNode = (node: any): boolean => {
  return !!node.relativePath.match(/^[^\/]+\/common\//);
};

const isRootNode = (node: any): boolean => {
  return !!node.relativePath.match(/^([^\/]+)\/index\.mdx?$/);
};

const isGuideRoot = (node: any): boolean => {
  return !!node.relativePath.match(/^([^\/]+)\/guides\/([^\/]+)\/index\.mdx?$/);
};

const buildPlatformData = (nodes: any[]) => {
  const data: PlatformData = {
    platforms: {},
    common: nodes.filter(node => getPlatfromFromNode(node) === "common"),
  };
  const platforms = data.platforms;

  // build up `platforms` data
  nodes.forEach((node: any) => {
    if (node.relativePath === "index.mdx" || node.relativePath === "index.md") {
      return;
    }

    const platformName = getPlatfromFromNode(node);
    if (platformName === "common") {
      return;
    }
    const guideName = getGuideFromNode(node);
    const isCommon = !guideName && isCommonNode(node);
    const isRoot = !guideName && !isCommon && isRootNode(node);
    const isIntegrationRoot = guideName && isGuideRoot(node);

    if (!platforms[platformName]) {
      platforms[platformName] = {
        node: null,
        children: [],
        guides: {},
        common: [],
      };
    }
    const pData = platforms[platformName];
    if (isRoot) {
      pData.node = node;
    } else if (isCommon) {
      pData.common.push(node);
    } else if (guideName) {
      if (!pData.guides[guideName]) {
        pData.guides[guideName] = {
          node: null,
          children: [],
        };
      }
      const iData = pData.guides[guideName];
      if (isIntegrationRoot) {
        iData.node = node;
      } else {
        iData.children.push(node);
      }
    } else {
      pData.children.push(node);
    }
  });
  return data;
};

const canInclude = (
  node: Node,
  platformName: string,
  guideName?: string
): boolean => {
  const canonical = guideName ? `${platformName}.${guideName}` : platformName;
  const { frontmatter } = getChild(node);
  if (
    frontmatter.supported &&
    frontmatter.supported.length &&
    frontmatter.supported.indexOf(canonical) === -1 &&
    frontmatter.supported.indexOf(platformName) === -1
  ) {
    return false;
  } else if (
    frontmatter.notSupported &&
    (frontmatter.notSupported.indexOf(canonical) !== -1 ||
      frontmatter.notSupported.indexOf(platformName) !== -1)
  ) {
    return false;
  }
  return true;
};

export default async ({ actions, graphql, reporter, getNode }) => {
  const {
    allFile: { nodes },
  } = await getDataOrPanic(
    `
    query {
      allFile(filter: { sourceInstanceName: { eq: "platforms" } }) {
        nodes {
          id
          relativePath
          internal {
            type
          }
          childMarkdownRemark {
            frontmatter {
              title
              description
              draft
              noindex
              sidebar_order
              redirect_from
              supported
              notSupported
              keywords
            }
            excerpt(pruneLength: 5000)
          }
          childMdx {
            frontmatter {
              title
              description
              draft
              noindex
              sidebar_order
              redirect_from
              supported
              notSupported
              keywords
            }
            excerpt(pruneLength: 5000)
          }
        }
      }
    }
    `,
    graphql,
    reporter
  );

  // filter out nodes with no markdown content
  const { common, platforms } = buildPlatformData(
    nodes.filter((n: any) => getChild(n))
  );

  // begin creating pages from `platforms`
  const component = require.resolve(`../../templates/platform.tsx`);

  const createPlatformPage = (
    node: any,
    path: string,
    context: { [key: string]: any }
  ) => {
    const child = getChild(node);
    actions.createPage({
      path: path,
      component,
      context: {
        excerpt: child.excerpt,
        ...child.frontmatter,
        ...context,
        id: node.id,
      },
    });
  };

  const createPlatformPages = (
    platformName: string,
    platformData: Platform,
    sharedCommon: Node[]
  ) => {
    if (!platformData.node) {
      throw new Error(`No node identified as root for ${platformName}`);
    }
    const platformPageContext = {
      platform: {
        name: platformName,
        title: getChild(platformData.node).frontmatter.title,
      },
    };

    const path = `/platforms${createFilePath({
      node: platformData.node,
      getNode,
    })}`;
    reporter.verbose(`Creating platform root for ${platformName}: ${path}`);
    createPlatformPage(platformData.node, path, platformPageContext);

    // duplicate global common
    sharedCommon.forEach((node: Node) => {
      if (!canInclude(node, platformName)) return;
      const path = `/platforms${createFilePath({ node, getNode }).replace(
        /^\/common\//,
        `/${platformName}/`
      )}`;
      reporter.verbose(`Creating global common for ${platformName}: ${path}`);
      createPlatformPage(node, path, {
        ...platformPageContext,
        // TODO(dcramer): toc is broken for hidden sections
        notoc: true,
      });
    });

    // duplicate platform common
    platformData.common.forEach((node: Node) => {
      if (!canInclude(node, platformName)) return;
      const path = `/platforms${createFilePath({ node, getNode }).replace(
        /^\/[^\/]+\/common\//,
        `/${platformName}/`
      )}`;
      reporter.verbose(`Creating platform common for ${platformName}: ${path}`);
      createPlatformPage(node, path, {
        ...platformPageContext,
        // TODO(dcramer): toc is broken for hidden sections
        notoc: true,
      });
    });

    // LAST (to allow overrides) create all direct children
    platformData.children.forEach((node: Node) => {
      const path = `/platforms${createFilePath({ node, getNode })}`;
      reporter.verbose(`Creating platform child for ${platformName}: ${path}`);
      createPlatformPage(node, path, platformPageContext);
    });

    // create guide roots
    Object.keys(platformData.guides).forEach(guideName => {
      createPlatformGuidePages(
        platformName,
        platformData,
        guideName,
        platformData.guides[guideName],
        sharedCommon,
        platformPageContext
      );
    });
  };

  const createPlatformGuidePages = (
    platformName: string,
    platformData: Platform,
    guideName: string,
    guideData: Guide,
    sharedCommon: Node[],
    sharedContext: { [key: string]: any }
  ) => {
    if (!guideData.node) {
      throw new Error(
        `No node identified as root for ${platformName} -> ${guideName}`
      );
    }

    const guidePageContext = {
      guide: {
        name: guideName,
        title: getChild(guideData.node).frontmatter.title,
      },
      ...sharedContext,
    };

    const pathRoot = `/platforms${createFilePath({
      node: guideData.node,
      getNode,
    })}`;
    reporter.verbose(
      `Creating platform root for ${platformName} -> ${guideName}: ${pathRoot}`
    );
    createPlatformPage(guideData.node, pathRoot, guidePageContext);

    // duplicate global common
    sharedCommon.forEach((node: Node) => {
      if (!canInclude(node, platformName, guideName)) return;
      const path = `${createFilePath({ node, getNode }).replace(
        /^\/common\//,
        pathRoot
      )}`;
      reporter.verbose(`Creating global common for ${platformName}: ${path}`);
      // XXX: we dont index or add redirects for guide-common pages
      createPlatformPage(node, path, {
        ...guidePageContext,
        noindex: true,
        // TODO(dcramer): toc is broken for hidden sections
        notoc: true,
        redirect_from: [],
      });
    });

    // duplicate platform common
    platformData.common.forEach((node: Node) => {
      if (!canInclude(node, platformName, guideName)) return;
      const path = `${createFilePath({ node, getNode }).replace(
        /^\/[^\/]+\/common\//,
        pathRoot
      )}`;
      reporter.verbose(
        `Creating platform common for ${platformName} -> ${guideName}: ${path}`
      );
      // XXX: we dont index or add redirects for guide-common pages
      createPlatformPage(node, path, {
        ...guidePageContext,
        noindex: true,
        // TODO(dcramer): toc is broken for hidden sections
        notoc: true,
        redirect_from: [],
      });
    });

    // LAST (to allow overrides) create all direct children
    guideData.children.forEach((node: Node) => {
      const path = `/platforms${createFilePath({ node, getNode })}`;
      reporter.verbose(
        `Creating platform child for ${platformName} -> ${guideName}: ${path}`
      );
      createPlatformPage(node, path, guidePageContext);
    });
  };

  Object.keys(platforms).forEach(platformName => {
    createPlatformPages(platformName, platforms[platformName], common);
  });

  const indexPage = nodes.find(n => n.relativePath === "index.mdx");
  if (indexPage) {
    actions.createPage({
      path: "/platforms/",
      component: require.resolve(`../../templates/doc.tsx`),
      context: {
        title: "Platforms",
        ...getChild(indexPage).frontmatter,
        id: indexPage.id,
      },
    });
  }
};
