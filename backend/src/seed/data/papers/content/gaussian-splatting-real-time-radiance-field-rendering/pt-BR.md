---
title: "Splatting de Gaussianas 3D para renderização de campos de radiância em tempo real"
summary: Uma cena capturada em fotos é transformada em milhões de Gaussianas 3D, otimizadas por gradiente descendente e desenhadas por um rasterizador rápido de GPU, alcançando renderização em tempo real em 1080p com qualidade próxima à dos métodos de campos de radiância mais lentos e melhores.
researchArea: Computação gráfica
keywords: splatting de gaussianas, campos de radiância, síntese de novas vistas, renderização em tempo real, renderização diferenciável, rasterização
version: 1.0
updatedAt: 2026-11-01
---

## Visão geral

A síntese de novas vistas é a tarefa de mostrar uma cena a partir de uma posição de câmera que ninguém fotografou, dado um conjunto de fotos dela. Os Neural Radiance Fields (NeRF) fizeram isso funcionar com qualidade impressionante, guardando a cena numa rede neural e renderizando por ray marching, que amostra muitos pontos ao longo de cada raio. Os métodos de maior qualidade são lentos para treinar e para renderizar, e os mais rápidos perdem qualidade. Para cenas sem limites em 1080p, os autores dizem que nenhum método anterior alcançava taxas de exibição em tempo real.

Este artigo, publicado na ACM Transactions on Graphics em 2023, de Bernhard Kerbl, Georgios Kopanas, Thomas Leimkühler e George Drettakis, propõe uma alternativa explícita. A ligação com o aprendizado de máquina é real, já que a cena é ajustada às fotos por gradiente descendente, mas a contribuição do artigo é uma representação de cena e um algoritmo de renderização. Não há rede neural na representação, e o que a torna rápida é o pipeline de rasterização de GPU que a computação gráfica usa há décadas.

Vale conhecer antes: rasterização em comparação com ray tracing, alpha blending, structure-from-motion (como as posições das câmeras são recuperadas das fotos) e a relação sinal-ruído de pico (PSNR) como medida de qualidade de imagem.

## Contribuição

- **Gaussianas 3D anisotrópicas** como representação da cena. Cada uma tem posição, opacidade, covariância (podendo ser esticada em qualquer direção) e cor em harmônicos esféricos, o que permite que a cor dependa da direção de visão.
- **Otimização com controle adaptativo de densidade.** Os parâmetros das Gaussianas são otimizados a partir das fotos, enquanto o número de Gaussianas muda no caminho: novas são adicionadas onde falta detalhe e outras são removidas.
- **Um rasterizador rápido, ciente de visibilidade e diferenciável,** que ordena os splats por bloco de tela, suporta splatting anisotrópico e retropropagação através de muitos splats sobrepostos, o que acelera o treinamento e a renderização.
- **A primeira abordagem, segundo os autores, que dá renderização de campos de radiância em tempo real (30 fps ou mais) em 1080p,** com qualidade que iguala os melhores métodos anteriores e tempos de treinamento competitivos com os mais rápidos.

## Metodologia

A entrada é um conjunto de fotos com poses de câmera obtidas por structure-from-motion, que também produz uma nuvem de pontos esparsa. As Gaussianas começam nesses pontos. A cada iteração uma vista é renderizada, comparada com a foto real por uma perda que combina L1 e similaridade estrutural, e os parâmetros das Gaussianas são atualizados. Periodicamente, Gaussianas com gradientes grandes são divididas ou clonadas e as quase transparentes são removidas. A renderização projeta cada Gaussiana na imagem, ordena os splats de cada bloco de 16x16 e os mistura da frente para trás.

Os autores avaliam em 13 cenas reais de três conjuntos de dados (Mip-NeRF360, Tanks and Temples, Deep Blending) e no conjunto sintético do NeRF, com uma a cada oito fotos reservada para teste, em uma GPU A6000. Comparam com o Mip-NeRF360 em qualidade e com o InstantNGP e o Plenoxels em velocidade. As ablações removem uma escolha de projeto por vez: inicialização a partir dos pontos esparsos, densificação, anisotropia, o número de splats que recebem gradientes e os harmônicos esféricos.

## Resultados

Estes são os resultados relatados pelos autores.

- No conjunto Mip-NeRF360, o modelo de 30 mil iterações tem PSNR de 27,21, treina em 41 minutos e renderiza a 134 fps. O Mip-NeRF360 tem PSNR de 27,69 (valor tomado do seu artigo), leva 48 horas e renderiza a 0,06 fps. O modelo de 7 mil iterações chega a 25,60 de PSNR em cerca de 6,5 minutos a 160 fps, contra 25,30 do InstantNGP-Base a 11,7 fps.
- Em Tanks and Temples, o modelo de 30 mil iterações tem PSNR de 23,14 contra 22,22 do Mip-NeRF360, e em Deep Blending 29,41 contra 29,40, ambos acima de 130 fps.
- As cenas usam de 1 a 5 milhões de Gaussianas. A memória é maior que nos métodos baseados em NeRF: 734 MB nas cenas do Mip-NeRF360 contra 8,6 MB do Mip-NeRF360 e de 13 a 48 MB do InstantNGP.
- No conjunto sintético do NeRF, partindo de 100 mil pontos aleatórios, o PSNR médio é 33,32, em linha com os métodos comparados, com renderização a 180 a 300 fps.
- As ablações mostram que a anisotropia importa para estruturas finas e que limitar quantos dos splats mais à frente recebem gradientes reduz muito a qualidade. Partir de pontos aleatórios em vez dos pontos esparsos prejudica principalmente o fundo.

## Análise crítica

O artigo combina uma ideia clara com engenharia cuidadosa, e relata as próprias fraquezas. Pontos a considerar:

- **A qualidade "iguala", não supera, no conjunto principal.** O Mip-NeRF360 ainda tem o maior PSNR e SSIM no conjunto Mip-NeRF360, e o novo método ganha em velocidade, em alguns conjuntos e em algumas métricas. A afirmação sólida é a de renderização em tempo real.
- **Os baselines são em parte execuções dos próprios autores.** A maioria dos números vem dos experimentos dos autores, com os resultados do Mip-NeRF360 tirados do seu artigo e o tempo de treinamento estimado a partir de uma execução de 12 horas em quatro GPUs A100. Isso é normal, mas não é um benchmark neutro.
- **Limites declarados pelos autores.** Há artefatos onde a cena é mal observada, Gaussianas alongadas ou manchadas, saltos (popping) quando surgem Gaussianas grandes, ausência de regularização e um algoritmo de visibilidade simples que pode trocar a ordem de mistura. A memória de treinamento do protótipo pode passar de 20 GB em cenas grandes, e cerca de 80% do tempo de treinamento é gasto em Python.
- **A tarefa é estreita.** O método supõe uma cena estática com câmeras calibradas e é julgado pela aparência das novas vistas. Em nossa leitura, ele ainda diz pouco sobre a qualidade da geometria subjacente, o que os próprios autores levantam ao sugerir a reconstrução de malhas como próximo passo.

## Pesquisas futuras

- Regularização, melhor descarte (culling) e antialiasing, para reduzir os saltos e os artefatos em regiões não vistas.
- Compressão da representação, usando ideias de compressão de nuvens de pontos, e uma implementação de mais baixo nível da otimização para reduzir memória e tempo.
- Reconstruir malhas a partir das Gaussianas, para entender onde a representação fica entre volumes e superfícies.
- Cenas muito grandes, como conjuntos urbanos, em que os autores notam em experimentos iniciais que a taxa de aprendizado das posições pode precisar ser reduzida para a otimização convergir.
