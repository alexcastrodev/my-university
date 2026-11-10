---
title: "Impacto do atraso e da qualidade do áudio na performance musical em rede"
summary: Onze duplas de músicos tocaram peças escolhidas por eles em duas salas isoladas enquanto os autores mudavam o atraso ou a taxa de amostragem do áudio, e os questionários indicam que eles conseguem tocar juntos com até cerca de 40 ms de atraso em cada sentido e mal percebem a queda de 88,2 kHz para 8 kHz.
researchArea: Computação musical
keywords: performance musical em rede, qualidade de experiência, latência de áudio, taxa de amostragem, avaliação subjetiva, 5g
version: 1.0
updatedAt: 2026-11-10
---

## Resumo

Network Music Performance (NMP) se refere à colaboração remota pela rede aplicada a apresentações musicais, como educação musical, produção musical e concertos ao vivo. Na NMP, o parâmetro mais importante para a qualidade de experiência (QoE) dos participantes é um atraso de áudio fim a fim baixo. Atrasos crescentes impedem a sincronização dos músicos e levam a uma experiência musical abaixo do ideal. O contato visual entre os participantes também é crucial para a experiência, mas exige muita largura de banda. Como a compressão de áudio acrescenta atrasos de codificação e decodificação no caminho do sinal, a maioria dos sistemas de NMP recorre à redução da qualidade do áudio quando a banda é limitada, para não violar os limites rigorosos de atraso da NMP. Para avaliar os limites de tolerância a atraso e a qualidade na NMP e verificar se eles podem ser atendidos pelas redes 5G emergentes, pedimos a onze duplas de músicos que tocassem peças de sua escolha em um ambiente de laboratório cuidadosamente controlado, que nos permitia definir diferentes atrasos fim a fim ou taxas de amostragem do áudio. Para avaliar a QoE dessas sessões de NMP, cada músico respondeu a um conjunto de perguntas após cada execução. A análise das respostas mostrou que músicos de verdade, em cenários de NMP com atraso controlado, conseguem se sincronizar com atrasos de até 40 ms, contra os 25-30 ms relatados em experimentos de palmas ritmadas. Nossa análise também mostra que a qualidade do áudio pode ser bastante reduzida por subamostragem, economizando banda sem perda significativa de QoE. Por fim, constatamos que os músicos dependem mais do áudio e menos do vídeo para se sincronizar durante uma sessão de NMP. Esses resultados indicam que a NMP pode se tornar viável em redes 5G avançadas.

## Visão geral

Network Music Performance (NMP), ou performance musical em rede, é quando músicos tocam juntos conectados por uma rede. Uma ligação de voz tolera uns 150 ms de atraso em cada sentido antes de a conversa ficar artificial, mas a música é muito mais exigente. O número mais citado é o Ensemble Performance Threshold, de cerca de 25 a 30 ms em um sentido, e ele vem principalmente de experimentos em que pessoas batem palmas em sincronia através de um enlace com atraso. Músicos que usam ferramentas específicas de NMP dizem que conseguem tocar juntos com atrasos maiores, e um estudo piloto do mesmo grupo, com quatro duplas, apontou na mesma direção.

A pergunta importa para o projeto de sistemas. Ferramentas de NMP costumam enviar áudio cru, sem compressão, porque até o Opus, feito para baixo atraso, acrescenta pelo menos 5 ms. Áudio cru custa caro em banda, e o vídeo disputa o mesmo uplink, que costuma ser estreito. Se os músicos aceitam uma qualidade de áudio menor, o sistema pode economizar banda amostrando com menos frequência, sem pagar o atraso de um codec.

Este artigo de 2025 da Future Internet, da Universidade de Economia e Negócios de Atenas e da University of Central Lancashire, amplia um artigo de conferência do NTMS de 2021. Ele testa duas hipóteses: que músicos toleram mais atraso com peças reais do que os estudos de palmas sugerem (H1) e que subamostrar o áudio não prejudica a experiência deles (H2).

## Contribuição

- **Um limite de atraso medido com música de verdade.** Os autores defendem que um atraso de 40 ms em cada sentido ainda dá uma experiência aceitável para peças rítmicas, em vez dos 25 a 30 ms tirados dos experimentos de palmas, e que isso deixa a NMP no limite do viável sobre 5G.
- **O primeiro olhar sobre qualidade de áudio em NMP, até onde eles sabem.** Taxas de amostragem de 88,2 kHz (estúdio) até 8 kHz (telefone) não mudaram de forma significativa as notas dos músicos.
- **Áudio acima do vídeo.** Com os dois canais disponíveis, os músicos disseram que se apoiavam principalmente no áudio para manter a sincronia, mesmo quando o vídeo chegava antes do áudio.
- **Escala.** Com 22 músicos em 11 duos, os autores o apresentam como o maior estudo de NMP com músicos e peças reais de que têm notícia.
- **Um questionário além do MOS.** Além da satisfação, ele pergunta sobre atraso percebido, sincronização percebida, seguir o parceiro, foco no áudio ou no vídeo, ansiedade e irritação.
- **Lições práticas** para quem for fazer estudos parecidos (piloto antes, questionários curtos, gravar tudo), e o conjunto de dados publicado no GitHub.

## Metodologia

Duas salas isoladas acústica e visualmente, no mesmo andar do prédio da universidade. Cada músico usa fones fechados, toca para um microfone condensador ligado a um mixer de 8 canais e vê o parceiro em um monitor de 32 polegadas. O vídeo vai como sinal analógico composto por um par trançado sobrando no cabeamento, o que evita o buffer do vídeo digital. Os autores o mediram filmando o cronômetro de um celular refletido pelas duas câmeras: 30 ms de ida e volta, cerca de 15 ms em cada sentido.

- **Cenário A (atraso).** Os mixers são ligados por cabos analógicos, e duas unidades analógicas de atraso AD-340 da Audio Research definem o atraso em cada direção. Cada duo toca uma peça de um minuto escolhida por ele dez vezes, com atrasos em um sentido de 5, 12,5, 17,5, 15, 10, 0, 20, 30, 40 e 60 ms, nessa ordem.
- **Cenário B (qualidade).** O áudio passa por PCs Linux com o software do próprio grupo, o Aretousa, pela rede Fast Ethernet do prédio com três switches, com atraso fixo de cerca de 10 ms em um sentido. Só a taxa de amostragem muda, sem compressão: 44,1, 36, 28, 22, 16, 12, 8, 18, 48 e 88,2 kHz, com amostras lineares de 16 bits, de 128 kbps a 1,411 Mbps por canal.
- **Medição do atraso.** Sincronizar os relógios das duas pontas é difícil, então eles medem a ida e volta (My Mouth to My Ear) e dividem por dois. Como as duas direções são configuradas iguais, isso dá o atraso Mouth to Ear, em um sentido, que o artigo relata.
- **Cegamento.** Os músicos não sabiam qual variável mudava, e a ordem das configurações foi escolhida para parecer aleatória. Não houve metrônomo. O cenário A sempre veio antes do B, com a mesma peça.
- **Questionário.** Depois de cada repetição, um questionário curto no tablet, com itens Likert de 5 pontos. Os dois cenários perguntam sobre satisfação (PoSat, o equivalente ao MOS), ansiedade e irritação. O cenário A acrescenta atraso percebido (PoAD), sincronização percebida (PoSD), tentativa de seguir o parceiro (TTF) e foco no áudio ou no vídeo. O cenário B acrescenta qualidade de áudio percebida (PoAQ).
- **Análise.** Regressão por mínimos quadrados ordinários de cada nota contra a variável controlada, tratando os valores Likert como números, com faixas de confiança de 95% e R² ajustado, feita no RStudio. Depois, uma ANOVA de medidas repetidas nas variáveis cujas tendências sugeriam relação.

Os instrumentos incluíram piano, órgão, violão, guitarra, baixo elétrico, violino, flauta, percussão e instrumentos tradicionais gregos como santouri, oud, alaúde e bouzouki, em estilos folk, rock, funk e clássico.

## Resultados

Estes são os resultados relatados pelos autores, como aparecem no texto.

- **Sincronização.** A reta de regressão do PoSD cai de 4,3 para 3 ao longo da faixa de atrasos. A média só cai de 3,75 para 3,5 entre 30 e 40 ms, com dispersão parecida, o que os autores leem como sincronia preservada até 40 ms.
- **Atraso percebido.** O PoAD sobe de 1,4 para 2,4, com 30 e 40 ms ambos muito perto de 2. Para os seis participantes de duos com pianista, a subida é mais íngreme, de 1,5 para 3,4.
- **Satisfação.** O PoSat vai de 4 para cerca de 3,4. Os autores não veem um limite abrupto, e sim uma queda gradual, e chamam 40 ms de limite superior prático para música rítmica. No subgrupo dos pianistas, ele cai de 4,7 para um pouco menos de 2,9.
- **Seguir o parceiro.** O TTF sobe de 2,8 para 3,9. As respostas são bem espalhadas em todos os atrasos, mas em 40 e principalmente em 60 ms mais músicos dizem que estavam seguindo o outro.
- **Áudio primeiro.** A reta do foco em áudio ou vídeo fica plana em 4,3 (5 significa só áudio), mesmo com o vídeo em atraso constante de 15 ms e o áudio chegando a 60 ms.
- **Conforto.** A ansiedade fica perto de 1,2 e a irritação vai de 1 a 1,7, então a montagem em si não incomodou os participantes.
- **Estatística do atraso.** A ANOVA de medidas repetidas dá p = 0,001 para PoSD, 0,013 para PoAD e 0,002 para TTF. O PoSat não é significativo (p = 0,819), o que os autores atribuem à satisfação continuar alta em todos os atrasos.
- **Qualidade do áudio.** O PoAQ fica perto de 3 em todas as taxas de amostragem, e o PoSat só se move de 3,2 para 3,5. Nenhum dos dois é significativo (p = 0,371 e 0,48). Os autores concluem que dá para cortar a taxa de amostragem em uma ordem de grandeza sem perda relevante de experiência, com os pianistas como um subgrupo possivelmente mais sensível.
- **Andamento, de um estudo complementar.** Uma análise separada das mesmas gravações, por processamento de sinais, mostrou que os músicos desaceleram quando o atraso cresce e mantêm o andamento estável até 40 ms, mas não em 60 ms.

## Análise crítica

A montagem é cuidadosa com o que controla: caminhos analógicos, atrasos medidos, um atraso de vídeo baixo e constante, e músicos tocando a própria música. As conclusões, porém, vão além do que os dados sustentam.

- **Amostra pequena e agrupada.** 22 músicos é muito para essa literatura, mas são 11 duos, e as duas respostas de um duo vêm da mesma execução, então não são independentes. O artigo informa "22 amostras" nas tabelas de ANOVA e não diz como tratou esse pareamento. O subgrupo dos pianistas, que sustenta várias afirmações, tem só seis pessoas.
- **A principal métrica de QoE não é significativa.** Os autores chamam o PoSat de variável mais importante, e a ANOVA dele dá p = 0,819. A conclusão dos 40 ms se apoia no PoSD e na leitura de diferenças pequenas entre dois pontos de atraso. Além disso, não há nenhuma configuração entre 40 e 60 ms: os autores admitem que não testaram essa faixa, então "pelo menos 40 ms" (Conclusões) e "limite superior prático" de 40 ms (Seção 5.1) descrevem a mesma lacuna em sentidos opostos.
- **Falta de significância não é prova de falta de efeito.** A H2 é dada como confirmada e a hipótese nula N2 como rejeitada porque p > 0,05. O raciocínio está invertido: um resultado não significativo em amostra pequena mostra falta de evidência, não equivalência, e nenhum teste de equivalência é apresentado. As notas perto de 3 até em 88,2 kHz também sugerem que o questionário, os fones ou a falta de uma amostra de referência talvez não discriminem bem a qualidade. Métodos como o MUSHRA, que os autores planejam para o futuro, comparam com uma referência oculta.
- **Efeitos de ordem.** O cenário A roda 0, 20, 30, 40 e 60 ms nas cinco últimas repetições, então os maiores atrasos sempre vêm por último, depois de até nove execuções da mesma peça. Cansaço, tédio ou prática podem se misturar com o atraso. O cenário B sempre vem depois do A, com a mesma peça, somando mais dez repetições. O artigo diz que a sequência parece aleatória, mas é a mesma sequência fixa para todos os duos.
- **Relato estatístico.** Os valores de R² ajustado (0,89, 0,86, 0,96) são altos para respostas Likert individuais espalhadas, o que sugere que o ajuste foi feito sobre as médias de cada configuração, mas o artigo não diz. A irritação tem R² ajustado de 0,96 e mesmo assim fica fora da ANOVA como sem correlação com o atraso. Dois pares de legendas repetem os mesmos valores (0,17 nas Figuras 13 e 15, 0,03 nas Figuras 14 e 16), o que parece erro de cópia. O texto também diz que os valores Likert "não são ordinais" quando quer dizer que não são intervalares, e as tabelas de ANOVA rotulam a linha dos valores p como "p = 0.05".
- **Pequenas inconsistências.** O texto põe pianistas nos duos 1, 2 e 5, mas a Tabela 3 lista órgão, e não piano, no duo 5. O texto diz que o subgrupo dos pianistas mostra "uma tendência de alta mais perceptível" na qualidade do áudio, enquanto a figura correspondente tem R² ajustado de 0,03. O resumo dá a faixa das palmas como 25 a 30 ms, enquanto os trabalhos relacionados citam o limite de Schuett como 20 a 30 ms.
- **Laboratório, não rede.** O cenário A não tem jitter, nem perda de pacotes, nem rede alguma, só cabos analógicos e caixas de atraso. O cenário B usa uma LAN tranquila. Redes reais, e o 5G em especial, trazem atraso variável que o software de NMP precisa absorver com buffers, o que soma ainda mais atraso. O argumento do 5G se apoia na medição do próprio grupo de uma mediana pouco acima de 40 ms em um sentido dentro de uma célula comercial non-standalone, uma mediana, e o resto do processamento ainda precisa ser somado.
- **Quem tocou o quê.** Os músicos escolheram as próprias peças, o que é realista, mas significa que andamento e dificuldade rítmica variam livremente entre os duos. Sem metrônomo, sem controle de andamento e sem dados sobre o nível ou a experiência dos músicos, além da observação de que nunca tinham tocado remotamente. Resultados de duos de folk grego e rock talvez não valham para estilos rápidos e muito travados ou para grupos maiores. A explicação dos pianistas (formação mais longa e mais formal) é um palpite que os dados não conseguem testar.
- **A afirmação sobre banda.** A subamostragem elimina tudo acima da metade da taxa de amostragem, então 8 kHz só guarda até 4 kHz. É interessante que isso não tenha incomodado a maioria dos músicos em uma tarefa de sincronia, mas diz pouco sobre apresentações feitas para uma plateia.

## Pesquisas futuras

- Estudar como instrumento, estilo e andamento afetam a tolerância ao atraso, o que segundo os autores exige muito mais experimentos, de preferência com outros grupos repetindo a mesma montagem.
- Combinar atraso e taxa de amostragem em um único desenho, para que uma MANOVA ou uma análise fatorial revele interações entre os dois que cenários separados não mostram.
- Acrescentar áudio comprimido com Opus, medido com PEAQ e talvez MUSHRA, e pesar o atraso extra do codec contra a banda que ele economiza.
- Analisar os vídeos gravados com reconhecimento de emoções por aprendizado de máquina a partir de traços faciais.
- Testar o número de 40 ms em redes 5G standalone reais, com o jitter e a perda que o laboratório eliminou.
